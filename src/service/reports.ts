import { AppContext, currentDay } from './context';
import { DayKey, addDays, daysBetween, heatingSeason, heatingSeasonBounds } from '../util/dates';
import { Delivery } from '../model/delivery';
import { NotFoundError } from '../core/errors';
import { gaugeRise, impliedNetGallons } from '../model/delivery';

/**
 * The numbers somebody asks for at the end of a month.
 *
 * All of it is derived from tickets and weather, none of it is stored. Two
 * things follow from that: the answers cannot drift from the underlying data,
 * and a report over five years of history is a full table scan. At this size
 * that takes about forty milliseconds, which is fine, and if it ever stops
 * being fine the fix is a materialised monthly table rather than caching this.
 */

export interface GallonsByPeriod {
  readonly period: string;
  readonly tickets: number;
  readonly grossGallons: number;
  readonly netGallons: number;
  readonly correctionGallons: number;
  readonly averageDrop: number;
}

export interface SeasonComparison {
  readonly season: number;
  readonly label: string;
  readonly degreeDays: number;
  readonly netGallons: number;
  readonly tickets: number;
  /** Gallons per degree day across the whole book, the number the owner watches. */
  readonly gallonsPerDegreeDay: number | null;
}

export interface DeliveryAccuracy {
  readonly tickets: number;
  readonly withBothGauges: number;
  /** Mean absolute difference between what the gauge implied and what the meter said. */
  readonly meanAbsoluteGallons: number;
  /** Signed mean, which says whether the meter runs rich or lean. */
  readonly meanSignedGallons: number;
  readonly worst: { ticketNumber: string; differenceGallons: number }[];
}

export interface RouteEfficiency {
  readonly routes: number;
  readonly stops: number;
  readonly plannedGallons: number;
  readonly deliveredGallons: number;
  /** Delivered as a share of planned. Under one means the trucks came back loaded. */
  readonly fillRate: number | null;
  readonly missedStops: number;
  readonly milesPlanned: number;
  readonly gallonsPerMile: number | null;
}

export class ReportService {
  constructor(private readonly context: AppContext) {}

  /** Gallons grouped by calendar month, oldest first. */
  gallonsByMonth(from: DayKey, to: DayKey): GallonsByPeriod[] {
    const buckets = new Map<string, Delivery[]>();
    for (const delivery of this.context.deliveries.list({ from, to, postedOnly: true })) {
      const key = delivery.deliveredOn.slice(0, 7);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.push(delivery);
      } else {
        buckets.set(key, [delivery]);
      }
    }
    return [...buckets.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([period, rows]) => summarise(period, rows));
  }

  /** The same, grouped by heating season rather than by calendar year. */
  gallonsBySeason(from: DayKey, to: DayKey): GallonsByPeriod[] {
    const buckets = new Map<number, Delivery[]>();
    for (const delivery of this.context.deliveries.list({ from, to, postedOnly: true })) {
      const season = heatingSeason(delivery.deliveredOn);
      const bucket = buckets.get(season);
      if (bucket) {
        bucket.push(delivery);
      } else {
        buckets.set(season, [delivery]);
      }
    }
    return [...buckets.entries()]
      .sort(([left], [right]) => left - right)
      .map(([season, rows]) =>
        summarise(`${season}/${String((season + 1) % 100).padStart(2, '0')}`, rows),
      );
  }

  /**
   * Gallons against degree days, season by season. A book that is growing shows
   * more gallons and a colder winter shows more gallons, and this is the only
   * view that tells the two apart.
   */
  seasonComparison(stationId: string, seasons: readonly number[]): SeasonComparison[] {
    if (this.context.weather.findStation(stationId) === undefined) {
      throw new NotFoundError('station', stationId);
    }
    return seasons.map((season) => {
      const bounds = heatingSeasonBounds(season);
      const ledger = this.context.weather.loadLedger(stationId, bounds.start, bounds.end);
      const degreeDays = ledger.accumulate(bounds.start, bounds.end);
      const deliveries = this.context.deliveries.list({
        from: bounds.start,
        to: bounds.end,
        postedOnly: true,
      });
      const netGallons = deliveries.reduce((total, row) => total + row.net, 0);
      return {
        season,
        label: `${season}/${String((season + 1) % 100).padStart(2, '0')}`,
        degreeDays,
        netGallons: round(netGallons),
        tickets: deliveries.length,
        gallonsPerDegreeDay: degreeDays > 0 ? round(netGallons / degreeDays, 4) : null,
      };
    });
  }

  /**
   * How well the gauge readings agree with the meter. A meter drifting out of
   * calibration shows up here weeks before the annual seal test catches it.
   */
  deliveryAccuracy(from: DayKey, to: DayKey, truckId?: string): DeliveryAccuracy {
    const deliveries = this.context.deliveries.list({
      from,
      to,
      postedOnly: true,
      ...(truckId ? { truckId } : {}),
    });
    const differences: { ticketNumber: string; differenceGallons: number }[] = [];
    for (const delivery of deliveries) {
      if (gaugeRise(delivery) === undefined) {
        continue;
      }
      const tank = this.context.tanks.find(delivery.tankId);
      if (!tank) {
        continue;
      }
      const implied = impliedNetGallons(delivery, tank.waterCapacity);
      if (implied === undefined) {
        continue;
      }
      differences.push({
        ticketNumber: delivery.ticketNumber,
        differenceGallons: round(delivery.net - implied, 2),
      });
    }
    const absolute = differences.map((entry) => Math.abs(entry.differenceGallons));
    const signed = differences.map((entry) => entry.differenceGallons);
    return {
      tickets: deliveries.length,
      withBothGauges: differences.length,
      meanAbsoluteGallons: mean(absolute),
      meanSignedGallons: mean(signed),
      worst: [...differences]
        .sort((left, right) => Math.abs(right.differenceGallons) - Math.abs(left.differenceGallons))
        .slice(0, 5),
    };
  }

  /** How close the routes came to what dispatch planned. */
  routeEfficiency(from: DayKey, to: DayKey): RouteEfficiency {
    const routes = this.context.routes.list({ from, to });
    let stops = 0;
    let plannedGallons = 0;
    let deliveredGallons = 0;
    let missedStops = 0;
    let milesPlanned = 0;
    for (const route of routes) {
      if (route.status === 'cancelled') {
        continue;
      }
      milesPlanned += route.plannedMiles;
      for (const stop of route.stops) {
        stops += 1;
        plannedGallons += stop.plannedGallons;
        if (stop.outcome === 'no_access' || stop.outcome === 'skipped') {
          missedStops += 1;
        }
        if (stop.deliveryId) {
          const delivery = this.context.deliveries.find(stop.deliveryId);
          if (delivery && delivery.status === 'posted') {
            deliveredGallons += delivery.net;
          }
        }
      }
    }
    return {
      routes: routes.filter((route) => route.status !== 'cancelled').length,
      stops,
      plannedGallons: round(plannedGallons),
      deliveredGallons: round(deliveredGallons),
      fillRate: plannedGallons > 0 ? round(deliveredGallons / plannedGallons, 4) : null,
      missedStops,
      milesPlanned: round(milesPlanned),
      gallonsPerMile: milesPlanned > 0 ? round(deliveredGallons / milesPlanned, 2) : null,
    };
  }

  /** A month ending on the day given, which is what the month end pack wants. */
  trailingMonth(on?: DayKey): { from: DayKey; to: DayKey; days: number } {
    const to = on ?? currentDay(this.context);
    const from = addDays(to, -29);
    return { from, to, days: daysBetween(from, to) + 1 };
  }
}

function summarise(period: string, rows: readonly Delivery[]): GallonsByPeriod {
  const grossGallons = rows.reduce((total, row) => total + row.gross, 0);
  const netGallons = rows.reduce((total, row) => total + row.net, 0);
  return {
    period,
    tickets: rows.length,
    grossGallons: round(grossGallons),
    netGallons: round(netGallons),
    correctionGallons: round(netGallons - grossGallons),
    averageDrop: rows.length === 0 ? 0 : round(netGallons / rows.length),
  };
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : round(values.reduce((a, b) => a + b, 0) / values.length, 2);
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
