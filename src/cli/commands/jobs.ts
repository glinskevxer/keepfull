import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { Column, emit, table } from '../output';
import { JobResult, runJob } from '../../jobs/runner';
import { buildJobRegistry } from '../../jobs';
import { currentDay } from '../../service/context';
import { dayKey } from '../../util/dates';

/**
 * Cron's entry point. Exits non zero when anything inside the job failed, so
 * the wrapper script does not have to read the output to know something needs
 * looking at.
 */
export function registerJobCommands(program: Command, deps: CliDeps): void {
  const jobs = program.command('jobs').description('the nightly work');

  jobs
    .command('list')
    .description('what cron can ask for')
    .action(() => {
      const registry = buildJobRegistry();
      const rows = registry.all().map((job) => ({ name: job.name, description: job.description }));
      const columns: Column<(typeof rows)[number]>[] = [
        { header: 'job', get: (row) => row.name },
        { header: 'what it does', get: (row) => row.description },
      ];
      emit(deps.writer, globalOptionsOf(jobs).format, rows, () => table(rows, columns));
    });

  jobs
    .command('run <name>')
    .description('run one job')
    .option('--as-of <day>', 'pretend today is this day')
    .option('--dry-run', 'work out what would happen without writing', false)
    .action((name: string, options: { asOf?: string; dryRun: boolean }) => {
      const { context } = deps.runtime();
      const job = buildJobRegistry().get(name);
      const result = runJob(job, {
        app: context,
        today: options.asOf ? dayKey(options.asOf) : currentDay(context),
        dryRun: options.dryRun,
      });
      emit(deps.writer, globalOptionsOf(jobs).format, result, () => summarise(result));
      if (result.failures.length > 0) {
        process.exitCode = 1;
      }
    });
}

function summarise(result: JobResult): string {
  const lines = [
    `${result.name}: ${result.processed} processed, ${result.changed} changed, ` +
      `${result.skipped} skipped, ${result.failures.length} failed in ${result.durationMs}ms`,
  ];
  for (const failure of result.failures.slice(0, 10)) {
    lines.push(`  ${failure.subject}: ${failure.error}`);
  }
  if (result.failures.length > 10) {
    lines.push(`  ... and ${result.failures.length - 10} more`);
  }
  return lines.join('\n');
}
