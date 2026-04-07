import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { DeliveryDraft, FillReason } from '../../model/delivery';
import { DeliveryService } from '../../service/deliveries';
import { emit } from '../output';
import { dayKey } from '../../util/dates';
import { item, problemLines, runImport, skipRow, summaryLine } from '../import-runner';
import { optionalColumn, requireColumn } from '../../util/csv';

/**
 * Loads a shift of tickets out of the file the handhelds dump.
 *
 * The handhelds post to the api when they have signal. This is the path for
 * when they do not, which in this territory is most of the west side, and it is
 * the path everybody actually uses because the driver plugs the unit in when
 * they get back rather than sitting in the yard waiting for wifi.
 *
 * Every row is posted on its own. A shift where one ticket is unpostable has to
 * load the other eleven, because the alternative is a driver keying twelve
 * tickets in by hand at half past six.
 */
export function registerTicketImportCommands(program: Command, deps: CliDeps): void {
  const tickets = program.command('tickets').description('delivery tickets off the handhelds');

  tickets
    .command('import <file>')
    .description('load a csv of tickets, one transaction per row')
    .option('--dry-run', 'read and check without posting anything', false)
    .action((file: string, options: { dryRun: boolean }) => {
      const { context } = deps.runtime();
      const service = new DeliveryService(context);
      const flagged: { ticketNumber: string; flags: string[] }[] = [];

      const outcome = runImport<DeliveryDraft>({
        file,
        dryRun: options.dryRun,
        subjectOf: (row) => `ticket ${row.ticket ?? '(none)'}`,
        readRow(row) {
          const draft: DeliveryDraft = {
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
          // A driver plugging the handheld in twice is normal, so a ticket
          // already on file is passed over rather than being a problem.
          return context.deliveries.findByTicketNumber(draft.ticketNumber) ? skipRow : item(draft);
        },
        writeOne(draft) {
          const result = service.post(draft);
          if (result.flags.length > 0) {
            flagged.push({ ticketNumber: result.delivery.ticketNumber, flags: result.flags });
          }
        },
      });

      context.logger.info('imported tickets', {
        file,
        read: outcome.read,
        posted: outcome.written,
        problems: outcome.problems.length,
      });
      emit(deps.writer, globalOptionsOf(tickets).format, { ...outcome, flagged }, () =>
        [
          summaryLine(outcome),
          ...flagged.map((entry) => `  flagged ${entry.ticketNumber}: ${entry.flags.join(', ')}`),
          ...problemLines(outcome),
        ].join('\n'),
      );
    });
}
