import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { DeliveryService } from '../../service/deliveries';
import { FillReason } from '../../model/delivery';
import { emit } from '../output';
import { dayKey } from '../../util/dates';
import { describeError } from '../../core/errors';
import { optionalColumn, parseCsvTable, requireColumn } from '../../util/csv';
import { readFileSync } from 'node:fs';

/**
 * Loads a shift of tickets out of the file the handhelds dump.
 *
 * The handhelds post to the api when they have signal. This is the path for
 * when they do not, which in this territory is most of the west side, and it is
 * the path everybody actually uses because the driver plugs the unit in when
 * they get back rather than sitting in the yard waiting for wifi.
 *
 * Every row is its own transaction. A shift where one ticket is unpostable has
 * to load the other eleven, because the alternative is a driver keying twelve
 * tickets in by hand at half past six.
 */

export interface TicketImportProblem {
  readonly line: number;
  readonly ticketNumber: string;
  readonly reason: string;
}

export interface TicketImportSummary {
  readonly file: string;
  readonly read: number;
  readonly posted: number;
  readonly skipped: number;
  readonly problems: TicketImportProblem[];
  readonly flagged: { ticketNumber: string; flags: string[] }[];
  readonly dryRun: boolean;
}

export function registerTicketImportCommands(program: Command, deps: CliDeps): void {
  const tickets = program.command('tickets').description('delivery tickets off the handhelds');

  tickets
    .command('import <file>')
    .description('load a csv of tickets, one transaction per row')
    .option('--dry-run', 'read and check without posting anything', false)
    .action((file: string, options: { dryRun: boolean }) => {
      const { context } = deps.runtime();
      const service = new DeliveryService(context);
      const parsed = parseCsvTable(readFileSync(file, 'utf8'));
      const problems: TicketImportProblem[] = [];
      const flagged: { ticketNumber: string; flags: string[] }[] = [];
      let posted = 0;
      let skipped = 0;

      parsed.rows.forEach((row, index) => {
        const line = index + 2;
        const ticketNumber = row.ticket ?? '(no ticket number)';
        try {
          const draft = {
            id: context.ids.next('dlv'),
            ticketNumber: requireColumn(row, 'ticket'),
            customerId: requireColumn(row, 'customer'),
            tankId: requireColumn(row, 'tank'),
            deliveredOn: dayKey(requireColumn(row, 'day')),
            gross: Number(requireColumn(row, 'gross')),
            meterTemperature: Number(requireColumn(row, 'temperature')),
            ...(optionalColumn(row, 'gauge_before')
              ? { gaugeBefore: Number(row.gauge_before) }
              : {}),
            ...(optionalColumn(row, 'gauge_after') ? { gaugeAfter: Number(row.gauge_after) } : {}),
            ...(optionalColumn(row, 'reason') ? { reason: row.reason as FillReason } : {}),
            driverId: requireColumn(row, 'driver'),
            truckId: requireColumn(row, 'truck'),
            ...(optionalColumn(row, 'notes') ? { notes: row.notes as string } : {}),
          };
          if (!Number.isFinite(draft.gross) || !Number.isFinite(draft.meterTemperature)) {
            throw new Error('gross and temperature both have to be numbers');
          }
          if (context.deliveries.findByTicketNumber(draft.ticketNumber)) {
            skipped += 1;
            return;
          }
          if (options.dryRun) {
            posted += 1;
            return;
          }
          const result = service.post(draft);
          posted += 1;
          if (result.flags.length > 0) {
            flagged.push({ ticketNumber: result.delivery.ticketNumber, flags: result.flags });
          }
        } catch (error) {
          problems.push({ line, ticketNumber, reason: describeError(error) });
        }
      });

      const summary: TicketImportSummary = {
        file,
        read: parsed.rows.length,
        posted,
        skipped,
        problems,
        flagged,
        dryRun: options.dryRun,
      };
      context.logger.info('imported tickets', {
        file,
        read: summary.read,
        posted: summary.posted,
        problems: summary.problems.length,
      });
      emit(deps.writer, globalOptionsOf(tickets).format, summary, () =>
        [
          `${summary.read} rows read, ${summary.posted} posted, ${summary.skipped} already on file` +
            (options.dryRun ? ' (dry run)' : ''),
          ...summary.flagged.map(
            (entry) => `  flagged ${entry.ticketNumber}: ${entry.flags.join(', ')}`,
          ),
          ...summary.problems.map(
            (problem) => `  line ${problem.line} ticket ${problem.ticketNumber}: ${problem.reason}`,
          ),
        ].join('\n'),
      );
    });
}
