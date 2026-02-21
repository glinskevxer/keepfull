import { AppContext } from '../service/context';
import { DayKey } from '../util/dates';
import { describeError } from '../core/errors';

/**
 * A very small job harness.
 *
 * There is no queue and no scheduler daemon. Cron runs `keepfull jobs run
 * <name>` and this decides what that means. What it adds over calling a
 * function directly is that every job reports the same shape, so the wrapper
 * script that mails the yard when something fails only has to understand one
 * thing.
 *
 * Jobs keep going after a failure on one item. A nightly forecast that stops at
 * the first tank with a broken monitor leaves nine hundred accounts without a
 * projection, which is a far worse outcome than nine hundred and one.
 */

export interface JobContext {
  readonly app: AppContext;
  readonly today: DayKey;
  readonly dryRun: boolean;
}

export interface JobFailure {
  readonly subject: string;
  readonly error: string;
}

export interface JobResult {
  readonly name: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly processed: number;
  readonly changed: number;
  readonly skipped: number;
  readonly failures: JobFailure[];
  readonly detail: Record<string, unknown>;
}

export interface Job {
  readonly name: string;
  readonly description: string;
  run(context: JobContext, report: JobReport): void;
}

/** What a job writes its counters into while it works. */
export class JobReport {
  processed = 0;
  changed = 0;
  skipped = 0;
  readonly failures: JobFailure[] = [];
  readonly detail: Record<string, unknown> = {};

  /** Runs one item and records a failure rather than letting it stop the job. */
  attempt(subject: string, work: () => boolean): void {
    this.processed += 1;
    try {
      if (work()) {
        this.changed += 1;
      } else {
        this.skipped += 1;
      }
    } catch (error) {
      this.failures.push({ subject, error: describeError(error) });
    }
  }

  note(key: string, value: unknown): void {
    this.detail[key] = value;
  }
}

export function runJob(job: Job, context: JobContext): JobResult {
  const startedAt = context.app.clock();
  const report = new JobReport();
  context.app.logger.info('job started', {
    job: job.name,
    today: context.today,
    dryRun: context.dryRun,
  });
  try {
    job.run(context, report);
  } catch (error) {
    report.failures.push({ subject: '(the job itself)', error: describeError(error) });
  }
  const finishedAt = context.app.clock();
  const result: JobResult = {
    name: job.name,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    processed: report.processed,
    changed: report.changed,
    skipped: report.skipped,
    failures: report.failures,
    detail: report.detail,
  };
  context.app.logger[result.failures.length > 0 ? 'warn' : 'info']('job finished', {
    job: job.name,
    processed: result.processed,
    changed: result.changed,
    skipped: result.skipped,
    failures: result.failures.length,
    ms: result.durationMs,
  });
  return result;
}

export class JobRegistry {
  private readonly jobs = new Map<string, Job>();

  register(job: Job): this {
    if (this.jobs.has(job.name)) {
      throw new Error(`there are two jobs called "${job.name}"`);
    }
    this.jobs.set(job.name, job);
    return this;
  }

  get(name: string): Job {
    const job = this.jobs.get(name);
    if (!job) {
      throw new Error(`no job called "${name}", try one of: ${this.names().join(', ')}`);
    }
    return job;
  }

  names(): string[] {
    return [...this.jobs.keys()].sort();
  }

  all(): Job[] {
    return this.names().map((name) => this.get(name));
  }
}
