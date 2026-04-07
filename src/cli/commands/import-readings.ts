import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { TankReading, makeReading } from '../../model/reading';
import { dayKey } from '../../util/dates';
import { emit } from '../output';
import { ignoreRow, item, problemLines, runImport, summaryLine } from '../import-runner';
import { optionalColumn, requireColumn } from '../../util/csv';

/**
 * Loads the tank monitor vendor's daily export.
 *
 * The file is keyed by the vendor's own monitor identifier, not by anything we
 * assigned, so the first thing this has to do is resolve each monitor back to a
 * tank. Monitors that resolve to nothing are the interesting output: they are
 * either a tank that came out and nobody told the vendor, or a monitor that was
 * moved and nobody told us. Both are worth a phone call and neither shows up
 * anywhere else.
 */
export function registerReadingImportCommands(program: Command, deps: CliDeps): void {
  const readings = program.command('readings').description('tank monitor telemetry');

  readings
    .command('import <file>')
    .description('load the monitor vendor daily export')
    .option('--dry-run', 'read and check without writing anything', false)
    .action((file: string, options: { dryRun: boolean }) => {
      const { context } = deps.runtime();
      const unknown = new Set<string>();

      const outcome = runImport<TankReading>({
        file,
        dryRun: options.dryRun,
        subjectOf: (row) => `monitor ${row.monitor ?? '(none)'}`,
        readRow(row) {
          const monitorId = requireColumn(row, 'monitor');
          const tank = context.tanks.findByMonitor(monitorId);
          if (!tank) {
            unknown.add(monitorId);
            return ignoreRow;
          }
          const gauge = Number(requireColumn(row, 'percent'));
          if (!Number.isFinite(gauge)) {
            throw new Error('percent has to be a number');
          }
          return item(
            makeReading({
              id: context.ids.next('rdg'),
              tankId: tank.id,
              takenOn: dayKey(requireColumn(row, 'day')),
              gauge,
              source: 'monitor',
              monitorId,
              ...(optionalColumn(row, 'note') ? { note: row.note as string } : {}),
            }),
          );
        },
        write: (batch) => context.readings.recordMany(batch),
      });

      const unknownMonitors = [...unknown].sort();
      if (unknownMonitors.length > 0) {
        context.logger.warn('the monitor export named monitors we do not have', {
          count: unknownMonitors.length,
          first: unknownMonitors[0] ?? null,
        });
      }
      context.logger.info('imported monitor readings', {
        file,
        read: outcome.read,
        written: outcome.written,
      });
      emit(deps.writer, globalOptionsOf(readings).format, { ...outcome, unknownMonitors }, () =>
        [
          summaryLine(outcome),
          unknownMonitors.length === 0
            ? 'every monitor matched a tank'
            : `${unknownMonitors.length} monitors matched nothing: ` +
              `${unknownMonitors.slice(0, 8).join(', ')}` +
              (unknownMonitors.length > 8 ? ' ...' : ''),
          ...problemLines(outcome),
        ].join('\n'),
      );
    });

  readings
    .command('unmatched')
    .description('tanks that carry a monitor which has never reported')
    .action(() => {
      const { context } = deps.runtime();
      const rows = context.tanks
        .list({ inServiceOnly: true, monitoredOnly: true })
        .map((tank) => ({
          tankId: tank.id,
          monitorId: tank.monitorId as string,
          readings: context.readings.count({ tankId: tank.id, source: 'monitor' }),
        }))
        .filter((row) => row.readings === 0);
      emit(deps.writer, globalOptionsOf(readings).format, rows, () =>
        rows.length === 0
          ? 'every monitor on the book has reported at least once'
          : rows.map((row) => `${row.tankId}  ${row.monitorId}  never reported`).join('\n'),
      );
    });
}
