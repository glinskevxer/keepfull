import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { Column, emit, table } from '../output';
import { ExceptionService } from '../../service/exceptions';
import { dayKey } from '../../util/dates';

/** The morning board, on the terminal. */
export function registerExceptionCommands(program: Command, deps: CliDeps): void {
  program
    .command('exceptions')
    .description('everything that needs looking at, worst first')
    .option('--as-of <day>', 'pretend today is this day')
    .option('--window <days>', 'how far ahead a tank counts as due', '7')
    .option('--sizing', 'include the tank sizing sweep, which is the slow part', false)
    .option('--today', 'only what has to be dealt with today', false)
    .action(function (
      this: Command,
      options: {
        asOf?: string;
        window: string;
        sizing: boolean;
        today: boolean;
      },
    ) {
      const service = new ExceptionService(deps.runtime().context);
      const report = service.report({
        ...(options.asOf ? { asOf: dayKey(options.asOf) } : {}),
        dueWindowDays: Number(options.window),
        includeSizing: options.sizing,
      });
      const rows = options.today
        ? report.exceptions.filter((entry) => entry.urgency === 'today')
        : report.exceptions;
      const columns: Column<(typeof rows)[number]>[] = [
        { header: 'when', get: (row) => row.urgency.replace('_', ' ') },
        { header: 'what', get: (row) => row.kind },
        { header: 'subject', get: (row) => row.subject },
        { header: 'detail', get: (row) => row.message },
      ];
      emit(deps.writer, globalOptionsOf(this).format, { ...report, exceptions: rows }, () =>
        [
          `${report.asOf}: ${rows.length} exceptions, ${report.today} for today`,
          table(rows, columns),
        ].join('\n'),
      );
    });
}
