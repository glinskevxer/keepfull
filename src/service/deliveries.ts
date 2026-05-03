import { AppContext, currentDay } from './context';
import { ConflictError, InvalidInputError, ServiceInterruptedError } from '../core/errors';
import { DayKey, dayKey, isDayKey } from '../util/dates';
import {
  Delivery,
  DeliveryDraft,
  gaugeRise,
  impliedNetGallons,
  makeDelivery,
} from '../model/delivery';
import { AuditContext, AuditService, SYSTEM_ACTOR } from './audit';
import { assertFits } from '../core/drop-sizing';
import { inTransaction } from '../db/connection';
import { isOutOfGas } from '../core/tank-math';
import { percent } from '../core/units';

/**
 * Posting a ticket.
 *
 * A ticket coming off a handheld has already happened; the gas is in the tank
 * and the customer has signed. So this does not get to refuse much. What it
 * does is refuse the things that mean the ticket itself is wrong rather than
 * the delivery being wrong: a drop bigger than the tank could hold, a gauge
 * that fell over a fill, a ticket number that does not check out.
 *
 * Everything else it notices, it records as a flag rather than a rejection.
 */

export type TicketFlag =
  | 'gauge_disagrees_with_meter'
  | 'was_out_of_gas'
  | 'leak_check_overdue'
  | 'no_gauge_readings'
  | 'unusually_large_drop';

export interface PostedTicket {
  readonly delivery: Delivery;
  readonly flags: TicketFlag[];
}

export interface PostOptions {
  /** Fraction the gauge and the meter may disagree by before it is flagged. */
  readonly gaugeTolerance?: number;
  /** Skip writing a driver reading from the closing gauge. */
  readonly skipReading?: boolean;
}

export class DeliveryService {
  private readonly audit: AuditService;

  constructor(private readonly context: AppContext) {
    this.audit = new AuditService(context);
  }

  post(
    draft: DeliveryDraft,
    options: PostOptions = {},
    who: AuditContext = { actor: SYSTEM_ACTOR },
  ): PostedTicket {
    const tank = this.context.tanks.get(draft.tankId);
    const customer = this.context.customers.get(draft.customerId);
    if (tank.customerId !== customer.id) {
      throw new ConflictError(`tank ${tank.id} does not belong to account ${customer.id}`, {
        tankId: tank.id,
        customerId: customer.id,
      });
    }
    if (!isDayKey(draft.deliveredOn)) {
      throw new InvalidInputError(`"${draft.deliveredOn}" is not a delivery day`);
    }
    const day = dayKey(draft.deliveredOn);
    if (day < tank.installedOn) {
      throw new ConflictError('the tank was not in the ground on that day', {
        tankId: tank.id,
        day,
      });
    }
    if (this.context.deliveries.findByTicketNumber(draft.ticketNumber)) {
      throw new ConflictError(`ticket ${draft.ticketNumber} has already been posted`, {
        ticketNumber: draft.ticketNumber,
      });
    }

    const delivery = makeDelivery(draft);
    if (delivery.gaugeBefore !== undefined) {
      assertFits(tank.id, tank.geometry, delivery.gaugeBefore, delivery.net);
    }

    const flags = this.inspect(delivery, tank.waterCapacity, options);

    inTransaction(this.context.db, () => {
      this.context.deliveries.insert(delivery);
      if (!options.skipReading && delivery.gaugeAfter !== undefined) {
        this.context.readings.record({
          id: this.context.ids.next('rdg'),
          tankId: tank.id,
          takenOn: day,
          gauge: delivery.gaugeAfter,
          source: 'driver',
        });
      }
      if (delivery.gaugeBefore !== undefined && isOutOfGas(delivery.gaugeBefore)) {
        // An interruption of service means the system has to be leak checked
        // before it is put back in, so the last check date is cleared and the
        // tank shows up on the compliance list until somebody signs it off.
        const { lastLeakCheckOn: _cleared, ...unchecked } = tank;
        this.context.tanks.update(unchecked);
      }
    });

    this.audit.record(who, {
      action: 'post',
      subjectKind: 'delivery',
      subjectId: delivery.id,
      after: {
        ticketNumber: delivery.ticketNumber,
        tankId: delivery.tankId,
        net: delivery.net,
        deliveredOn: delivery.deliveredOn,
      },
      ...(flags.length > 0 ? { note: flags.join(', ') } : {}),
    });
    this.context.logger.info('posted a ticket', {
      ticketNumber: delivery.ticketNumber,
      tankId: tank.id,
      net: delivery.net,
      flags: flags.join(','),
    });
    return { delivery, flags };
  }

  private inspect(delivery: Delivery, waterCapacity: number, options: PostOptions): TicketFlag[] {
    const flags: TicketFlag[] = [];
    const tolerance = options.gaugeTolerance ?? 0.12;
    if (delivery.gaugeBefore === undefined || delivery.gaugeAfter === undefined) {
      flags.push('no_gauge_readings');
    } else {
      const implied = impliedNetGallons(delivery, waterCapacity);
      if (implied !== undefined && implied > 0) {
        const gap = Math.abs(implied - delivery.net) / implied;
        if (gap > tolerance) {
          flags.push('gauge_disagrees_with_meter');
        }
      }
      if (isOutOfGas(delivery.gaugeBefore)) {
        flags.push('was_out_of_gas');
      }
      const rise = gaugeRise(delivery) ?? 0;
      if (rise > 75) {
        flags.push('unusually_large_drop');
      }
    }
    return flags;
  }

  /**
   * A tank that lost pressure cannot be put back in service on a driver's word
   * alone. This is the record that somebody went back and checked it.
   */
  recordLeakCheck(tankId: string, on: DayKey): void {
    const tank = this.context.tanks.get(tankId);
    if (on < tank.installedOn) {
      throw new ConflictError('a leak check cannot predate the tank', { tankId, on });
    }
    this.context.tanks.recordLeakCheck(tankId, on);
    this.context.logger.info('recorded a leak check', { tankId, on });
  }

  /** Refuses to leave a tank that ran out sitting without a check. */
  assertServiceRestored(tankId: string, on: DayKey = currentDay(this.context)): void {
    const tank = this.context.tanks.get(tankId);
    const lastFill = this.context.deliveries.lastDeliveryFor(tankId);
    if (!lastFill || lastFill.gaugeBefore === undefined || !isOutOfGas(lastFill.gaugeBefore)) {
      return;
    }
    if (tank.lastLeakCheckOn === undefined || tank.lastLeakCheckOn < lastFill.deliveredOn) {
      throw new ServiceInterruptedError(tankId, lastFill.deliveredOn);
    }
    if (tank.lastLeakCheckOn > on) {
      throw new ConflictError('the leak check is dated after the day being asked about', {
        tankId,
        on,
      });
    }
  }

  void(deliveryId: string, note: string, who: AuditContext = { actor: SYSTEM_ACTOR }): Delivery {
    const delivery = this.context.deliveries.get(deliveryId);
    this.context.deliveries.void(deliveryId, note);
    const after = this.context.deliveries.get(deliveryId);
    this.audit.recordChange(who, 'void', 'delivery', deliveryId, delivery, after, note);
    this.context.logger.warn('voided a ticket', {
      ticketNumber: delivery.ticketNumber,
      actor: who.actor,
      note,
    });
    return after;
  }

  /** Records the gauge a customer read over the phone. */
  recordCustomerReading(tankId: string, on: DayKey, gauge: number): void {
    this.context.tanks.get(tankId);
    this.context.readings.record({
      id: this.context.ids.next('rdg'),
      tankId,
      takenOn: on,
      gauge: percent(gauge),
      source: 'customer',
    });
  }
}
