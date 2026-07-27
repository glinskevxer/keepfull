import { AppContext } from './context';
import { DayKey } from '../util/dates';
import { NotFoundError } from '../core/errors';
import { Reconciliation, ToleranceOptions, driftTrend, reconcile } from '../core/reconcile';
import { TruckLoad, meteredOut } from '../model/truck-load';
import { round } from '../util/round';

/**
 * Ties the day's loads to the day's tickets.
 *
 * The awkward part is that a truck can load twice in a day, and a ticket does
 * not say which load it came off. So a day is reconciled as a whole rather than
 * load by load, which is what the yard does on paper anyway.
 */

export interface ShiftReconciliation extends Reconciliation {
  readonly truckId: string;
  readonly day: DayKey;
  readonly loads: number;
  readonly openShifts: number;
}

export interface DriftReport {
  readonly truckId: string;
  readonly days: number;
  readonly run: number;
  readonly direction: 'rich' | 'lean' | 'none';
  readonly meanGap: number;
  readonly suspect: boolean;
}

export class ReconciliationService {
  constructor(private readonly context: AppContext) {}

  forShift(truckId: string, day: DayKey, options: ToleranceOptions = {}): ShiftReconciliation {
    this.context.fleet.getTruck(truckId);
    const loads = this.context.loads.list({ truckId, from: day, to: day });
    if (loads.length === 0) {
      throw new NotFoundError(`load for truck ${truckId} on ${day}`, truckId);
    }
    const plantGallons = round(loads.reduce((total, load) => total + load.plantGross, 0));
    const openShifts = loads.filter((load) => meteredOut(load) === undefined).length;
    const meteredGallons =
      openShifts > 0
        ? null
        : round(loads.reduce((total, load) => total + (meteredOut(load) ?? 0), 0));
    const tickets = this.context.deliveries.list({ truckId, from: day, to: day, postedOnly: true });
    const ticketedGallons = round(tickets.reduce((total, ticket) => total + ticket.gross, 0));

    return {
      ...reconcile(plantGallons, meteredGallons, ticketedGallons, tickets.length, options),
      truckId,
      day,
      loads: loads.length,
      openShifts,
    };
  }

  /** Every truck that loaded on a day, reconciled. */
  forDay(day: DayKey, options: ToleranceOptions = {}): ShiftReconciliation[] {
    const truckIds = new Set(
      this.context.loads.list({ from: day, to: day }).map((load: TruckLoad) => load.truckId),
    );
    return [...truckIds].sort().map((truckId) => this.forShift(truckId, day, options));
  }

  /** Whether a truck's meter has been off in the same direction for a while. */
  drift(truckId: string, from: DayKey, to: DayKey, options: ToleranceOptions = {}): DriftReport {
    this.context.fleet.getTruck(truckId);
    const days = [
      ...new Set(this.context.loads.list({ truckId, from, to }).map((load) => load.loadedOn)),
    ].sort();
    const gaps: number[] = [];
    for (const day of days) {
      const shift = this.forShift(truckId, day, options);
      if (shift.plantVsMetered !== null) {
        gaps.push(shift.plantVsMetered);
      }
    }
    const trend = driftTrend(gaps);
    return {
      truckId,
      days: gaps.length,
      run: trend.run,
      direction: trend.direction,
      meanGap: trend.meanGap,
      suspect: trend.direction !== 'none',
    };
  }
}
