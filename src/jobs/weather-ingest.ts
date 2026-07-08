import { DailyTemperature } from '../core/degree-days';
import { Job, JobContext, JobReport } from './runner';
import { addDays, dayKey } from '../util/dates';
import { fahrenheit } from '../core/units';
import { parseCsvTable, requireColumn } from '../util/csv';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Picks up whatever the nightly pull dropped in the spool directory.
 *
 * The pull itself is a shell script somebody else maintains and it is not going
 * to be rewritten in here. What it does is drop a file per station into a
 * directory, named `<station>-<day>.csv`, and re-send the last week every time
 * because that is simpler than working out what has already been sent.
 *
 * So this has to be idempotent, and it is: the observation table upserts on
 * station and day, so a file arriving twice changes nothing. Files are left
 * where they are rather than being deleted, because a fortnight of them on disk
 * has settled two arguments about whether a cold snap was real.
 */

export const SPOOL_ENV = 'WEATHER_SPOOL_DIR';

export interface SpoolFile {
  readonly name: string;
  readonly stationId: string;
  readonly day: string;
}

const NAME = /^([A-Z0-9]{3,6})-(\d{4}-\d{2}-\d{2})\.csv$/;

export function parseSpoolName(name: string): SpoolFile | undefined {
  const match = NAME.exec(name);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return { name, stationId: match[1], day: match[2] };
}

/** The files worth reading: named right, and not older than the window. */
export function selectFiles(
  names: readonly string[],
  today: string,
  windowDays: number,
): SpoolFile[] {
  const oldest = addDays(dayKey(today), -windowDays);
  return names
    .map(parseSpoolName)
    .filter((file): file is SpoolFile => file !== undefined)
    .filter((file) => file.day >= oldest && file.day <= today)
    .sort((left, right) => (left.name < right.name ? -1 : 1));
}

export function readObservations(text: string): {
  observations: DailyTemperature[];
  problems: string[];
} {
  const parsed = parseCsvTable(text);
  const observations: DailyTemperature[] = [];
  const problems: string[] = [];
  parsed.rows.forEach((row, index) => {
    try {
      const high = Number(requireColumn(row, 'high'));
      const low = Number(requireColumn(row, 'low'));
      if (!Number.isFinite(high) || !Number.isFinite(low)) {
        throw new Error('high and low both have to be numbers');
      }
      if (low > high) {
        throw new Error(`low ${low} is above high ${high}`);
      }
      observations.push({
        day: dayKey(requireColumn(row, 'day')),
        high: fahrenheit(high),
        low: fahrenheit(low),
      });
    } catch (error) {
      problems.push(`line ${index + 2}: ${(error as Error).message}`);
    }
  });
  return { observations, problems };
}

export const weatherIngest: Job = {
  name: 'weather-ingest',
  description: 'load whatever the nightly pull dropped in the spool directory',

  run(context: JobContext, report: JobReport): void {
    const directory = process.env[SPOOL_ENV];
    if (!directory) {
      report.note('skipped', `${SPOOL_ENV} is not set`);
      return;
    }

    let names: string[] = [];
    try {
      names = readdirSync(directory);
    } catch (error) {
      report.note('skipped', `cannot read ${directory}: ${(error as Error).message}`);
      return;
    }

    const files = selectFiles(names, context.today, 14);
    report.note('spool', directory);
    report.note('files', files.length);
    const known = new Set(context.app.weather.listStations().map((station) => station.id));
    const recordedAt = context.app.clock();
    let written = 0;
    const unknownStations = new Set<string>();

    for (const file of files) {
      report.attempt(file.name, () => {
        if (!known.has(file.stationId)) {
          unknownStations.add(file.stationId);
          return false;
        }
        const { observations, problems } = readObservations(
          readFileSync(join(directory, file.name), 'utf8'),
        );
        for (const problem of problems) {
          report.failures.push({ subject: file.name, error: problem });
        }
        if (context.dryRun) {
          return observations.length > 0;
        }
        for (const observation of observations) {
          context.app.weather.recordObservation(file.stationId, observation, recordedAt);
          written += 1;
        }
        return observations.length > 0;
      });
    }

    report.note('observations', written);
    if (unknownStations.size > 0) {
      report.note('unknownStations', [...unknownStations].sort());
      context.app.logger.warn('the spool named stations we do not have', {
        stations: [...unknownStations].join(','),
      });
    }
  },
};
