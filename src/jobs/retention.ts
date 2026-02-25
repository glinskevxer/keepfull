import { Job, JobContext, JobReport } from './runner';
import { addDays } from '../util/dates';

/**
 * Housekeeping on the reading table.
 *
 * Gauge readings are the only thing here that grows without bound: nine hundred
 * monitored tanks reporting daily is a third of a million rows a year, against
 * a few thousand tickets. Three years is kept because the burn model reaches
 * back two winters and somebody always wants to argue about the one before it.
 */

export const READING_RETENTION_DAYS = 365 * 3;

export const retention: Job = {
  name: 'retention',
  description: 'drop gauge readings older than the retention window',

  run(context: JobContext, report: JobReport): void {
    const cutoff = addDays(context.today, -READING_RETENTION_DAYS);
    report.note('cutoff', cutoff);

    const doomed = context.app.readings.list({ to: addDays(cutoff, -1) }).length;
    report.note('doomed', doomed);
    report.processed = doomed;

    if (context.dryRun || doomed === 0) {
      report.skipped = doomed;
      report.note('deleted', 0);
      return;
    }
    const deleted = context.app.readings.purgeBefore(cutoff);
    report.changed = deleted;
    report.note('deleted', deleted);
  },
};
