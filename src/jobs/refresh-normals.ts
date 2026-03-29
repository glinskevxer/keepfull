import { Job, JobContext, JobReport } from './runner';
import { addDays } from '../util/dates';
import { buildNormals } from '../core/normals';

/**
 * Rebuilds each station's normal year from the weather we hold.
 *
 * This runs once a year, in July, when the heating season is over and nothing
 * downstream is going to notice a normal moving by half a degree day. Running
 * it in January would move every projected reserve date on the book overnight
 * for no reason anybody could explain to a customer.
 */

/** How far back to look. Six winters is what this dealer has kept. */
export const NORMALS_HISTORY_DAYS = 365 * 6;

export const refreshNormals: Job = {
  name: 'refresh-normals',
  description: 'rebuild the degree day normals for each station from history',

  run(context: JobContext, report: JobReport): void {
    const from = addDays(context.today, -NORMALS_HISTORY_DAYS);
    const stations = context.app.weather.listStations({ activeOnly: true });
    report.note('stations', stations.length);

    for (const station of stations) {
      report.attempt(station.id, () => {
        const ledger = context.app.weather.loadLedger(station.id, from, context.today);
        const observations = ledger.days().map((day) => ledger.get(day)!);
        if (observations.length < 365) {
          report.note(`${station.id}.skipped`, `${observations.length} days is under a year`);
          return false;
        }
        const { normals, summary } = buildNormals(station.id, observations);
        report.note(`${station.id}.seasonTotal`, summary.seasonTotal);
        report.note(`${station.id}.days`, summary.days);
        if (context.dryRun) {
          return true;
        }
        for (const key of monthDaysOf(normals)) {
          context.app.weather.saveNormal(station.id, key, normals.forDay(`2024-${key}` as never));
        }
        return true;
      });
    }
  },
};

/** The normal year has no public iterator, so walk the calendar and ask it. */
function monthDaysOf(normals: { forDay(day: string): number }): string[] {
  const keys: string[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const days = new Date(Date.UTC(2024, month, 0)).getUTCDate();
    for (let day = 1; day <= days; day += 1) {
      const key = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (normals.forDay(`2024-${key}`) > 0) {
        keys.push(key);
      }
    }
  }
  return keys;
}
