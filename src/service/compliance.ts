import { AppContext, currentDay } from './context';
import {
  ComplianceItem,
  ComplianceWindow,
  compareItems,
  inspectTank,
  inspectTruck,
  isBlocking,
} from '../core/compliance';
import { DayKey } from '../util/dates';
import { isOutOfGas } from '../core/tank-math';

/**
 * The compliance list the office works down every Monday.
 *
 * It is built fresh each time rather than stored. Everything it reports is
 * derived from dates that already live on tanks and trucks, and a stored copy
 * would only be a second place for those dates to be wrong.
 */

export interface ComplianceReport {
  readonly asOf: DayKey;
  readonly items: ComplianceItem[];
  readonly blocking: number;
  readonly due: number;
  readonly watch: number;
}

export interface InterruptionRecord {
  readonly tankId: string;
  readonly customerId: string;
  readonly day: DayKey;
  readonly gaugeBefore: number;
  readonly checkedOn?: DayKey;
  readonly cleared: boolean;
}

export class ComplianceService {
  constructor(private readonly context: AppContext) {}

  report(options: { asOf?: DayKey; window?: ComplianceWindow } = {}): ComplianceReport {
    const asOf = options.asOf ?? currentDay(this.context);
    const window = options.window ?? {};
    const items: ComplianceItem[] = [];
    for (const tank of this.context.tanks.list({ inServiceOnly: true })) {
      items.push(...inspectTank(tank, asOf, window));
    }
    for (const truck of this.context.fleet.listTrucks({ activeOnly: true })) {
      items.push(...inspectTruck(truck, asOf, window));
    }
    items.sort(compareItems);
    return {
      asOf,
      items,
      blocking: items.filter((item) => item.severity === 'blocking').length,
      due: items.filter((item) => item.severity === 'due').length,
      watch: items.filter((item) => item.severity === 'watch').length,
    };
  }

  /** Whether this tank may be filled at all today. */
  canFill(tankId: string, on?: DayKey): { allowed: boolean; reasons: string[] } {
    const asOf = on ?? currentDay(this.context);
    const tank = this.context.tanks.get(tankId);
    const items = inspectTank(tank, asOf);
    const blocking = items.filter((item) => item.severity === 'blocking');
    const reasons = blocking.map((item) => item.message);
    const customer = this.context.customers.get(tank.customerId);
    if (customer.holdReason) {
      reasons.push(`account ${customer.accountNumber} is on hold: ${customer.holdReason}`);
    }
    return { allowed: reasons.length === 0, reasons };
  }

  /** Every tank that has run out, and whether it has been signed off since. */
  interruptions(from: DayKey, to: DayKey): InterruptionRecord[] {
    const records: InterruptionRecord[] = [];
    for (const delivery of this.context.deliveries.list({ from, to, postedOnly: true })) {
      if (delivery.gaugeBefore === undefined || !isOutOfGas(delivery.gaugeBefore)) {
        continue;
      }
      const tank = this.context.tanks.find(delivery.tankId);
      const checkedOn = tank?.lastLeakCheckOn;
      records.push({
        tankId: delivery.tankId,
        customerId: delivery.customerId,
        day: delivery.deliveredOn,
        gaugeBefore: delivery.gaugeBefore,
        ...(checkedOn ? { checkedOn } : {}),
        cleared: checkedOn !== undefined && checkedOn >= delivery.deliveredOn,
      });
    }
    return records;
  }

  /** Trucks that must not go out today, for the morning board. */
  groundedTrucks(on?: DayKey): { truckId: string; unitNumber: string; reason: string }[] {
    const asOf = on ?? currentDay(this.context);
    const grounded: { truckId: string; unitNumber: string; reason: string }[] = [];
    for (const truck of this.context.fleet.listTrucks({ activeOnly: true })) {
      const items = inspectTruck(truck, asOf);
      if (isBlocking(items)) {
        grounded.push({
          truckId: truck.id,
          unitNumber: truck.unitNumber,
          reason: items.find((item) => item.severity === 'blocking')?.message ?? 'blocked',
        });
      }
    }
    return grounded;
  }
}
