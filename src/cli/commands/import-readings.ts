import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { TankReading, makeReading } from '../../model/reading';
import { dayKey } from '../../util/dates';
import { describeError } from '../../core/errors';
import { emit } from '../output';
import { optionalColumn, parseCsvTable, requireColumn } from '../../util/csv';
import { readFileSync } from 'node:fs';

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

export interface ReadingImportSummary {
  readonly file: string;
  readonly read: number;
  readonly written: number;
  readonly unknownMonitors: string[];
  readonly problems: { line: number; monitorId: string; reason: string }[];
  readonly dryRun: boolean;
}

export function registerReadingImportCommands(program: Command, deps: CliDeps): void {
  const readings = program.command('readings').description('tank monitor telemetry');

  readings
    .command('import <file>')
    .description('load the monitor vendor daily export')
    .option('--dry-run', 'read and check without writing anything', false)
    .action((file: string, options: { dryRun: boolean }) => {
      const { context } = deps.runtime();
      const parsed = parseCsvTable(readFileSync(file, 'utf8'));
      const unknown = new Set<string>();
      const problems: { line: number; monitorId: string; reason: string }[] = [];
      const batch: TankReading[] = [];

      parsed.rows.forEach((row, index) => {
        const line = index + 2;
        const monitorId = row.monitor ?? '(no monitor)';
        try {
          const id = requireColumn(row, 'monitor');
          const tank = context.tanks.findByMonitor(id);
          if (!tank) {
            unknown.add(id);
            return;
          }
          const gauge = Number(requireColumn(row, 'percent'));
          if (!Number.isFinite(gauge)) {
            throw new Error('percent has to be a number');
          }
          batch.push(
            makeReading({
              id: context.ids.next('rdg'),
              tankId: tank.id,
              takenOn: dayKey(requireColumn(row, 'day')),
              gauge,
              source: 'monitor',
              monitorId: id,
              ...(optionalColumn(row, 'note') ? { note: row.note as string } : {}),
            }),
          );
        } catch (error) {
          problems.push({ line, monitorId, reason: describeError(error) });
        }
      });

      const written = options.dryRun ? 0 : context.readings.recordMany(batch);
      const summary: ReadingImportSummary = {
        file,
        read: parsed.rows.length,
        written,
        unknownMonitors: [...unknown].sort(),
        problems,
        dryRun: options.dryRun,
      };
      if (summary.unknownMonitors.length > 0) {
        context.logger.warn('the monitor export named monitors we do not have', {
          count: summary.unknownMonitors.length,
          first: summary.unknownMonitors[0] ?? null,
        });
      }
      context.logger.info('imported monitor readings', {
        file,
        read: summary.read,
        written: summary.written,
      });
      emit(deps.writer, globalOptionsOf(readings).format, summary, () =>
        [
          `${summary.read} rows read, ${batch.length} matched a tank, ${summary.written} written` +
            (options.dryRun ? ' (dry run)' : ''),
          summary.unknownMonitors.length === 0
            ? 'every monitor matched a tank'
            : `${summary.unknownMonitors.length} monitors matched nothing: ` +
              `${summary.unknownMonitors.slice(0, 8).join(', ')}` +
              (summary.unknownMonitors.length > 8 ? ' ...' : ''),
          ...summary.problems.map(
            (problem) => `  line ${problem.line} monitor ${problem.monitorId}: ${problem.reason}`,
          ),
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
