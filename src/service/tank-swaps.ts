import { AppContext, currentDay } from './context';
import { AuditContext, AuditService, SYSTEM_ACTOR } from './audit';
import { ConflictError, InvalidInputError } from '../core/errors';
import { DayKey } from '../util/dates';
import { Tank, makeTank } from '../model/tank';
import { inTransaction } from '../db/connection';

/**
 * Swapping a tank out for another one.
 *
 * This happens for three reasons: the tank is undersized, it failed an
 * inspection, or the customer bought the house and wants their own. All three
 * end the same way, with a tank coming out on a day and another going in, and
 * the thing that goes wrong every time is the history.
 *
 * The new tank has none. If its first fill is treated as an ordinary fill, the
 * burn model reads the whole interval from the old tank's last fill to the new
 * tank's first as one stretch on the new tank, which is nonsense. So the fill
 * that follows a swap is marked `tank_swap`, and the interval builder already
 * refuses to anchor on that.
 */

export interface SwapRequest {
  readonly outgoingTankId: string;
  readonly on?: DayKey;
  /** The tank going in. Either an existing one off the yard, or a new one. */
  readonly incomingTankId?: string;
  readonly newTank?: {
    readonly serialNumber: string;
    readonly waterCapacity: number;
    readonly owner: 'company' | 'customer';
    readonly setting?: 'above_ground' | 'underground' | 'mounded';
    readonly monitorId?: string;
  };
  readonly reason: 'undersized' | 'failed_inspection' | 'customer_owned' | 'other';
  readonly note?: string;
}

export interface SwapResult {
  readonly outgoing: Tank;
  readonly incoming: Tank;
  readonly on: DayKey;
  /** Gallons believed to be in the old tank, which come off the customer's bill. */
  readonly creditGallons: number;
}

export class TankSwapService {
  private readonly audit: AuditService;

  constructor(private readonly context: AppContext) {
    this.audit = new AuditService(context);
  }

  swap(request: SwapRequest, who: AuditContext = { actor: SYSTEM_ACTOR }): SwapResult {
    const outgoing = this.context.tanks.get(request.outgoingTankId);
    const on = request.on ?? currentDay(this.context);
    if (outgoing.removedOn !== undefined) {
      throw new ConflictError(`tank ${outgoing.id} already came out on ${outgoing.removedOn}`, {
        tankId: outgoing.id,
      });
    }
    if (on < outgoing.installedOn) {
      throw new ConflictError('a tank cannot come out before it went in', { on });
    }
    if ((request.incomingTankId === undefined) === (request.newTank === undefined)) {
      throw new InvalidInputError('a swap needs exactly one of an existing tank or a new one');
    }

    // The gallons in the old tank go back to the customer, so the swap has to
    // capture them before the tank is pulled and its readings stop mattering.
    const reading = this.context.readings.latestFor(outgoing.id, { measuredOnly: true, asOf: on });
    const creditGallons =
      reading === undefined
        ? 0
        : Math.round(((outgoing.waterCapacity * reading.gauge) / 100) * 10) / 10;

    return inTransaction(this.context.db, () => {
      // The outgoing tank comes out first. Its monitor id is unique across
      // tanks in service, so the new tank cannot take it over while the old
      // one is still holding it.
      this.context.tanks.remove(outgoing.id, on);

      let incoming: Tank;
      if (request.incomingTankId !== undefined) {
        incoming = this.context.tanks.get(request.incomingTankId);
        if (incoming.id === outgoing.id) {
          throw new InvalidInputError('a tank cannot be swapped for itself');
        }
        if (incoming.removedOn !== undefined) {
          throw new ConflictError(`tank ${incoming.id} is out of service`, { tankId: incoming.id });
        }
        this.context.tanks.reassign(incoming.id, outgoing.customerId);
      } else {
        const spec = request.newTank as NonNullable<SwapRequest['newTank']>;
        incoming = makeTank({
          id: this.context.ids.next('tnk'),
          customerId: outgoing.customerId,
          serialNumber: spec.serialNumber,
          waterCapacity: spec.waterCapacity,
          owner: spec.owner,
          ...(spec.setting ? { setting: spec.setting } : {}),
          appliances: outgoing.appliances,
          installedOn: on,
          ...(spec.monitorId ? { monitorId: spec.monitorId } : {}),
        });
        this.context.tanks.insert(incoming);
      }

      const removed = this.context.tanks.get(outgoing.id);

      this.audit.record(who, {
        action: 'tank_swap',
        subjectKind: 'tank',
        subjectId: outgoing.id,
        before: { inService: true, monitorId: outgoing.monitorId ?? null },
        after: { inService: false, replacedBy: incoming.id, on },
        note: request.note ? `${request.reason}: ${request.note}` : request.reason,
      });

      this.context.logger.info('swapped a tank', {
        customerId: outgoing.customerId,
        outgoing: outgoing.id,
        incoming: incoming.id,
        on,
        creditGallons,
        reason: request.reason,
      });

      return {
        outgoing: removed,
        incoming: this.context.tanks.get(incoming.id),
        on,
        creditGallons,
      };
    });
  }

  /**
   * Whether a tank's history can be trusted yet after a swap. Until the new
   * tank has had two anchored fills of its own there is nothing to fit.
   */
  historyIsUsable(tankId: string): { usable: boolean; anchoredFills: number } {
    const tank = this.context.tanks.get(tankId);
    const fills = this.context.deliveries
      .historyForTank(tankId)
      .filter(
        (delivery) =>
          delivery.gaugeAfter !== undefined &&
          delivery.gaugeAfter >= tank.geometry.fillLimit - 3 &&
          delivery.reason !== 'tank_swap' &&
          delivery.reason !== 'new_tank',
      );
    return { usable: fills.length >= 2, anchoredFills: fills.length };
  }
}
