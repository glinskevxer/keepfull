import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { ConflictError } from '../../core/errors';
import { MIGRATIONS } from '../../db/migrations';
import { appliedMigrations, currentVersion, pendingMigrations } from '../../db/migrate';
import { compact, integrityCheck, tableNames } from '../../db/connection';
import { Column, emit, table } from '../output';
import { addDays, dayKey } from '../../util/dates';
import { describeSettings } from '../../config/env';
import { backup, verify } from '../../db/backup';
import { benchmark, renderTimings } from '../../dev/bench';
import { seed } from '../../dev/seed';

/**
 * Housekeeping. Nothing in here is run often, and two of them are only ever
 * run at half past six in the morning when something has gone wrong, so they
 * all print what they did rather than succeeding silently.
 */
export function registerAdminCommands(program: Command, deps: CliDeps): void {
  const admin = program.command('admin').description('database and configuration housekeeping');

  admin
    .command('status')
    .description('what this process is pointed at and what shape it is in')
    .action(() => {
      const { context, db } = deps.runtime();
      const settings = deps.settings();
      const payload = {
        settings: describeSettings(settings),
        schemaVersion: currentVersion(db),
        pendingMigrations: pendingMigrations(db, MIGRATIONS).map((entry) => entry.version),
        integrity: integrityCheck(db),
        tables: tableNames(db).length,
        counts: {
          customers: context.customers.count(),
          tanks: context.tanks.list().length,
          deliveries: context.deliveries.list().length,
          stations: context.weather.listStations().length,
        },
      };
      emit(deps.writer, globalOptionsOf(admin).format, payload, () =>
        [
          `database   ${settings.databasePath}`,
          `schema     version ${payload.schemaVersion}, ${payload.pendingMigrations.length} pending`,
          `integrity  ${payload.integrity}`,
          `holds      ${payload.counts.customers} accounts, ${payload.counts.tanks} tanks, ` +
            `${payload.counts.deliveries} tickets, ${payload.counts.stations} stations`,
        ].join('\n'),
      );
    });

  admin
    .command('migrations')
    .description('what has been applied and what has not')
    .action(() => {
      const { db } = deps.runtime();
      const applied = appliedMigrations(db);
      const pending = pendingMigrations(db, MIGRATIONS);
      const rows = [
        ...applied.map((entry) => ({
          version: entry.version,
          name: entry.name,
          state: 'applied',
          at: entry.appliedAt,
        })),
        ...pending.map((entry) => ({
          version: entry.version,
          name: entry.name,
          state: 'pending',
          at: '-',
        })),
      ].sort((left, right) => left.version - right.version);
      const columns: Column<(typeof rows)[number]>[] = [
        { header: 'version', get: (row) => String(row.version), align: 'right' },
        { header: 'name', get: (row) => row.name },
        { header: 'state', get: (row) => row.state },
        { header: 'applied at', get: (row) => row.at },
      ];
      emit(deps.writer, globalOptionsOf(admin).format, rows, () => table(rows, columns));
    });

  admin
    .command('seed')
    .description('fill an empty database with a yard that behaves like the real one')
    .option('--customers <count>', 'how many accounts to make', '40')
    .option('--seed <number>', 'the generator seed, so a run can be repeated', '20250217')
    .option('--force', 'seed even though there are already accounts on file', false)
    .action((options: { customers: string; seed: string; force: boolean }) => {
      const { context } = deps.runtime();
      const existing = context.customers.count();
      if (existing > 0 && !options.force) {
        throw new ConflictError(
          `there are already ${existing} accounts on file, pass --force to seed anyway`,
          { existing },
        );
      }
      const summary = seed(context, {
        customers: Number(options.customers),
        seed: Number(options.seed),
      });
      emit(deps.writer, globalOptionsOf(admin).format, summary, () =>
        [
          `${summary.customers} accounts, ${summary.tanks} tanks`,
          `${summary.deliveries} tickets, ${summary.observations} observations`,
          `${summary.stations} stations, ${summary.trucks} trucks`,
        ].join('\n'),
      );
    });

  admin
    .command('backup <path>')
    .description('take a copy through sqlite own backup, then open it and check it')
    .action(async (path: string) => {
      const { db } = deps.runtime();
      const result = await backup(db, path);
      const checked = verify(path);
      emit(deps.writer, globalOptionsOf(admin).format, { ...result, verified: checked }, () =>
        [
          `wrote ${path}, ${(result.bytes / 1024 / 1024).toFixed(1)} MB in ${result.durationMs}ms`,
          `schema version ${result.schemaVersion}, ${result.tables} tables, integrity ${result.integrity}`,
          checked.ok
            ? 'the copy opens and reads clean'
            : `PROBLEMS: ${checked.problems.join('; ')}`,
        ].join('\n'),
      );
      if (!checked.ok) {
        process.exitCode = 1;
      }
    });

  admin
    .command('verify-backup <path>')
    .description('open a copy and say whether it is worth having')
    .action((path: string) => {
      const result = verify(path);
      emit(deps.writer, globalOptionsOf(admin).format, result, () =>
        [
          `${path}: ${result.ok ? 'usable' : 'NOT usable'}`,
          `integrity ${result.integrity}, schema version ${result.schemaVersion}`,
          ...Object.entries(result.counts).map(([table, count]) => `  ${table}: ${count}`),
          ...result.problems.map((problem) => `  ${problem}`),
        ].join('\n'),
      );
      if (!result.ok) {
        process.exitCode = 1;
      }
    });

  admin
    .command('bench')
    .description('time the four things that get slower as the book grows')
    .option('--runs <count>', 'how many times to run each', '3')
    .action((options: { runs: string }) => {
      const { context } = deps.runtime();
      const timings = benchmark(context, {
        runs: Number(options.runs),
        yard: deps.settings().yard,
      });
      emit(deps.writer, globalOptionsOf(admin).format, timings, () => renderTimings(timings));
    });

  admin
    .command('compact')
    .description('reclaim space and refresh the query planner statistics')
    .action(() => {
      const { db } = deps.runtime();
      const before = tableNames(db).length;
      compact(db);
      emit(
        deps.writer,
        globalOptionsOf(admin).format,
        { tables: before, integrity: integrityCheck(db) },
        () => `compacted, ${before} tables, integrity ${integrityCheck(db)}`,
      );
    });

  admin
    .command('purge-readings <before>')
    .description('drop gauge readings older than a day')
    .option('--dry-run', 'count what would go without deleting it', false)
    .action((before: string, options: { dryRun: boolean }) => {
      const { context } = deps.runtime();
      const cutoff = dayKey(before);
      const doomed = context.readings.list({ to: addDays(cutoff, -1) }).length;
      const deleted = options.dryRun ? 0 : context.readings.purgeBefore(cutoff);
      emit(
        deps.writer,
        globalOptionsOf(admin).format,
        { before, doomed, deleted, dryRun: options.dryRun },
        () =>
          options.dryRun
            ? `${doomed} readings are older than ${before} (dry run)`
            : `deleted ${deleted} readings older than ${before}`,
      );
    });
}
