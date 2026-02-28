import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { MIGRATIONS } from '../../db/migrations';
import { appliedMigrations, currentVersion, pendingMigrations } from '../../db/migrate';
import { compact, integrityCheck, tableNames } from '../../db/connection';
import { Column, emit, table } from '../output';
import { addDays, dayKey } from '../../util/dates';
import { describeSettings } from '../../config/env';

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
