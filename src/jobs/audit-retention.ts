import { Job, JobContext, JobReport } from './runner';
import { addDays } from '../util/dates';

/**
 * Trimming the audit trail, eventually.
 *
 * Seven years, because that is how long the accounts are kept and an audit
 * trail that outlives the records it describes is a liability rather than an
 * asset. The floor is enforced in the repository as well as here, so somebody
 * running this by hand with the wrong argument cannot take last month's.
 */

export const AUDIT_RETENTION_DAYS = 365 * 7;

export const auditRetention: Job = {
  name: 'audit-retention',
  description: 'drop audit entries older than seven years',

  run(context: JobContext, report: JobReport): void {
    const cutoff = addDays(context.today, -AUDIT_RETENTION_DAYS);
    report.note('cutoff', cutoff);

    const doomed = context.app.audit.count({ to: addDays(cutoff, -1) });
    report.note('doomed', doomed);
    report.processed = doomed;

    if (context.dryRun || doomed === 0) {
      report.skipped = doomed;
      report.note('deleted', 0);
      return;
    }
    const deleted = context.app.audit.purgeBefore(cutoff, AUDIT_RETENTION_DAYS);
    report.changed = deleted;
    report.note('deleted', deleted);
    context.app.logger.info('trimmed the audit trail', { cutoff, deleted });
  },
};
