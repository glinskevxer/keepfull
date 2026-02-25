import { Job, JobContext, JobReport } from './runner';
import { daysBetween } from '../util/dates';
import { hasMonitor } from '../model/tank';

/**
 * Finds monitors that have stopped talking.
 *
 * A tank monitor that goes quiet does not look like a problem, it looks like a
 * tank nobody is worried about. The forecast keeps projecting off the last
 * reading it saw and the account sails past its reserve day with the office
 * showing a comfortable forty percent. This is the job that catches that, and
 * it is the reason the vendor invoice is worth paying.
 */

export interface QuietMonitor {
  readonly tankId: string;
  readonly monitorId: string;
  readonly customerId: string;
  readonly lastHeardOn: string | null;
  readonly silentDays: number | null;
}

/** Quiet for this long in the heating season means somebody has to go look. */
export const SILENCE_THRESHOLD_DAYS = 4;

export const monitorHealth: Job = {
  name: 'monitor-health',
  description: 'find tank monitors that have stopped reporting',

  run(context: JobContext, report: JobReport): void {
    const quiet: QuietMonitor[] = [];
    const tanks = context.app.tanks.list({ inServiceOnly: true, monitoredOnly: true });
    report.note('monitoredTanks', tanks.length);

    for (const tank of tanks) {
      report.attempt(tank.id, () => {
        if (!hasMonitor(tank)) {
          return false;
        }
        const latest = context.app.readings.list({
          tankId: tank.id,
          source: 'monitor',
          limit: 1,
        })[0];
        const lastHeardOn = latest?.takenOn ?? null;
        const silentDays = lastHeardOn === null ? null : daysBetween(lastHeardOn, context.today);
        if (silentDays !== null && silentDays <= SILENCE_THRESHOLD_DAYS) {
          return false;
        }
        quiet.push({
          tankId: tank.id,
          monitorId: tank.monitorId as string,
          customerId: tank.customerId,
          lastHeardOn,
          silentDays,
        });
        return true;
      });
    }

    quiet.sort((left, right) => (right.silentDays ?? 9999) - (left.silentDays ?? 9999));
    report.note('quiet', quiet);
    report.note('quietCount', quiet.length);
    if (quiet.length > 0) {
      context.app.logger.warn('monitors have gone quiet', {
        count: quiet.length,
        worst: quiet[0]?.tankId ?? null,
      });
    }
  },
};
