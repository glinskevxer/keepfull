import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { Column, emit, gallons, table } from '../output';
import { ReportService } from '../../service/reports';
import { addDays, dayKey, heatingSeason } from '../../util/dates';
import { currentDay } from '../../service/context';

/** The month end pack, on the terminal. */
export function registerReportCommands(program: Command, deps: CliDeps): void {
  const reports = program.command('reports').description('gallons, seasons and how the trucks did');

  const rangeOf = (options: { from?: string; to?: string }, defaultDays: number) => {
    const { context } = deps.runtime();
    const to = options.to ? dayKey(options.to) : currentDay(context);
    const from = options.from ? dayKey(options.from) : addDays(to, -defaultDays);
    return { from, to };
  };

  reports
    .command('gallons')
    .description('gallons by month or by heating season')
    .option('--from <day>', 'first day')
    .option('--to <day>', 'last day')
    .option('--by <period>', 'month or season', 'month')
    .action((options: { from?: string; to?: string; by: string }) => {
      const { context } = deps.runtime();
      const service = new ReportService(context);
      const { from, to } = rangeOf(options, 365);
      const rows =
        options.by === 'season'
          ? service.gallonsBySeason(from, to)
          : service.gallonsByMonth(from, to);
      const columns: Column<(typeof rows)[number]>[] = [
        { header: 'period', get: (row) => row.period },
        { header: 'tickets', get: (row) => String(row.tickets), align: 'right' },
        { header: 'gross', get: (row) => gallons(row.grossGallons), align: 'right' },
        { header: 'net', get: (row) => gallons(row.netGallons), align: 'right' },
        { header: 'correction', get: (row) => gallons(row.correctionGallons), align: 'right' },
        { header: 'avg drop', get: (row) => gallons(row.averageDrop), align: 'right' },
      ];
      emit(deps.writer, globalOptionsOf(reports).format, rows, () => table(rows, columns));
    });

  reports
    .command('seasons <stationId>')
    .description('gallons against degree days, season by season')
    .option('--back <count>', 'how many seasons to show', '3')
    .action((stationId: string, options: { back: string }) => {
      const { context } = deps.runtime();
      const service = new ReportService(context);
      const current = heatingSeason(currentDay(context));
      const back = Number(options.back);
      const seasons = Array.from({ length: back }, (_value, index) => current - (back - 1 - index));
      const rows = service.seasonComparison(stationId, seasons);
      const columns: Column<(typeof rows)[number]>[] = [
        { header: 'season', get: (row) => row.label },
        { header: 'degree days', get: (row) => row.degreeDays.toFixed(0), align: 'right' },
        { header: 'net gallons', get: (row) => gallons(row.netGallons), align: 'right' },
        { header: 'tickets', get: (row) => String(row.tickets), align: 'right' },
        {
          header: 'gal/dd',
          get: (row) =>
            row.gallonsPerDegreeDay === null ? '-' : row.gallonsPerDegreeDay.toFixed(4),
          align: 'right',
        },
      ];
      emit(deps.writer, globalOptionsOf(reports).format, rows, () => table(rows, columns));
    });

  reports
    .command('meter-accuracy')
    .description('how far the gauges and the meters disagree')
    .option('--from <day>', 'first day')
    .option('--to <day>', 'last day')
    .option('--truck <id>', 'only this truck')
    .action((options: { from?: string; to?: string; truck?: string }) => {
      const { context } = deps.runtime();
      const service = new ReportService(context);
      const { from, to } = rangeOf(options, 90);
      const result = service.deliveryAccuracy(from, to, options.truck);
      emit(deps.writer, globalOptionsOf(reports).format, result, () =>
        [
          `${from} to ${to}${options.truck ? `, truck ${options.truck}` : ''}`,
          `${result.tickets} tickets, ${result.withBothGauges} with both gauges read`,
          `mean absolute ${gallons(result.meanAbsoluteGallons)} gal, ` +
            `signed ${gallons(result.meanSignedGallons)} gal`,
          result.worst.length === 0
            ? 'nothing out of line'
            : `worst: ${result.worst
                .map((entry) => `${entry.ticketNumber} ${gallons(entry.differenceGallons)}`)
                .join(', ')}`,
        ].join('\n'),
      );
    });

  reports
    .command('routes')
    .description('planned against delivered')
    .option('--from <day>', 'first day')
    .option('--to <day>', 'last day')
    .action((options: { from?: string; to?: string }) => {
      const { context } = deps.runtime();
      const service = new ReportService(context);
      const { from, to } = rangeOf(options, 30);
      const result = service.routeEfficiency(from, to);
      emit(deps.writer, globalOptionsOf(reports).format, result, () =>
        [
          `${from} to ${to}`,
          `${result.routes} routes, ${result.stops} stops, ${result.missedStops} missed`,
          `planned ${gallons(result.plannedGallons)} gal, delivered ${gallons(result.deliveredGallons)} gal` +
            (result.fillRate === null ? '' : ` (${(result.fillRate * 100).toFixed(0)}%)`),
          result.gallonsPerMile === null
            ? 'no miles planned'
            : `${result.milesPlanned.toFixed(0)} miles, ${result.gallonsPerMile.toFixed(1)} gal per mile`,
        ].join('\n'),
      );
    });
}
