import { AppContext } from '../service/context';
import { DispatchService } from '../service/dispatch';
import { ExceptionService } from '../service/exceptions';
import { ForecastingService } from '../service/forecasting';
import { ReportService } from '../service/reports';
import { addDays, heatingSeason } from '../util/dates';

/**
 * Timing the four things that get slower as the book grows.
 *
 * This is not a microbenchmark and it does not pretend to be. It runs the same
 * work the morning does, against a seeded yard, and prints how long each part
 * took. The point is to notice the day one of them goes from two hundred
 * milliseconds to four seconds, which has happened twice, both times because a
 * query lost an index rather than because anything got algorithmically worse.
 */

export interface Timing {
  readonly name: string;
  readonly runs: number;
  readonly totalMs: number;
  readonly meanMs: number;
  readonly slowestMs: number;
  readonly detail: string;
}

export interface BenchOptions {
  readonly runs?: number;
  readonly yard?: { latitude: number; longitude: number };
  readonly now?: () => number;
}

/** Runs something a few times and reports how long it took. */
export function time(
  name: string,
  runs: number,
  work: () => string,
  now: () => number = () => Date.now(),
): Timing {
  let total = 0;
  let slowest = 0;
  let detail = '';
  for (let run = 0; run < runs; run += 1) {
    const started = now();
    detail = work();
    const took = now() - started;
    total += took;
    slowest = Math.max(slowest, took);
  }
  return {
    name,
    runs,
    totalMs: total,
    meanMs: Math.round((total / runs) * 100) / 100,
    slowestMs: slowest,
    detail,
  };
}

export function benchmark(context: AppContext, options: BenchOptions = {}): Timing[] {
  const runs = options.runs ?? 3;
  const yard = options.yard ?? { latitude: 42.4432, longitude: -76.5019 };
  const now = options.now ?? (() => Date.now());
  const today = context.clock().toISOString().slice(0, 10) as never;

  const forecasting = new ForecastingService(context);
  const dispatch = new DispatchService(context, yard);
  const exceptions = new ExceptionService(context);
  const reports = new ReportService(context);

  return [
    time(
      'forecast the whole book',
      runs,
      () => {
        const tanks = context.tanks.list({ inServiceOnly: true });
        const done = tanks.filter(
          (tank) => forecasting.tryForTank(tank.id, { asOf: today }) !== undefined,
        ).length;
        return `${done} of ${tanks.length} tanks forecast`;
      },
      now,
    ),
    time(
      'plan a day onto the trucks',
      runs,
      () => {
        const plan = dispatch.plan({ asOf: today, windowDays: 7 });
        const stops = plan.plan.routes.reduce((total, route) => total + route.stops.length, 0);
        return `${stops} stops over ${plan.plan.routes.length} routes`;
      },
      now,
    ),
    time(
      'build the morning board',
      runs,
      () => {
        const board = exceptions.report({ asOf: today });
        return `${board.exceptions.length} exceptions`;
      },
      now,
    ),
    time(
      'a season of gallons against degree days',
      runs,
      () => {
        const season = heatingSeason(today) - 1;
        const rows = reports.seasonComparison(
          context.weather.listStations({ activeOnly: true })[0]?.id ?? 'KITH',
          [season],
        );
        return `${rows[0]?.netGallons ?? 0} gallons`;
      },
      now,
    ),
    time(
      'a year of gallons by month',
      runs,
      () => {
        const rows = reports.gallonsByMonth(addDays(today, -365), today);
        return `${rows.length} months`;
      },
      now,
    ),
  ];
}

export function renderTimings(timings: readonly Timing[]): string {
  const width = Math.max(...timings.map((timing) => timing.name.length));
  return timings
    .map(
      (timing) =>
        `${timing.name.padEnd(width)}  ${String(timing.meanMs).padStart(8)} ms mean  ` +
        `${String(timing.slowestMs).padStart(8)} ms worst  ${timing.detail}`,
    )
    .join('\n');
}
