import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { Column, emit, table } from '../output';
import { addDays, dayKey } from '../../util/dates';
import { currentDay } from '../../service/context';
import { item, problemLines, runImport, summaryLine } from '../import-runner';
import { requireColumn } from '../../util/csv';
import { DailyTemperature } from '../../core/degree-days';
import { fahrenheit } from '../../core/units';

/**
 * Weather from the terminal, including the import the nightly pull uses.
 *
 * The import takes a file rather than reading standard input, because the pull
 * script keeps the file around for a fortnight and being able to re-run the
 * exact same import on the exact same bytes has settled two arguments about
 * whether a cold snap was real.
 */
export function registerWeatherCommands(program: Command, deps: CliDeps): void {
  const weather = program.command('weather').description('stations, observations and degree days');

  weather
    .command('stations')
    .description('list the stations and how much weather each has')
    .action(() => {
      const { context } = deps.runtime();
      const rows = context.weather.listStations().map((station) => ({
        id: station.id,
        name: station.name,
        base: station.baseTemperature,
        observations: context.weather.countObservations(station.id),
        latest: context.weather.latestObservationDay(station.id) ?? '-',
        active: station.active,
      }));
      const columns: Column<(typeof rows)[number]>[] = [
        { header: 'station', get: (row) => row.id },
        { header: 'name', get: (row) => row.name },
        { header: 'base', get: (row) => String(row.base), align: 'right' },
        { header: 'days', get: (row) => String(row.observations), align: 'right' },
        { header: 'latest', get: (row) => row.latest },
        { header: 'active', get: (row) => (row.active ? 'yes' : 'no') },
      ];
      emit(deps.writer, globalOptionsOf(weather).format, rows, () => table(rows, columns));
    });

  weather
    .command('import <stationId> <file>')
    .description('load a csv of day,high,low into a station')
    .option('--dry-run', 'read and check the file without writing', false)
    .action((stationId: string, file: string, options: { dryRun: boolean }) => {
      const { context } = deps.runtime();
      context.weather.getStation(stationId);
      const at = context.clock();

      const outcome = runImport<DailyTemperature>({
        file,
        dryRun: options.dryRun,
        subjectOf: (row) => `day ${row.day ?? '(none)'}`,
        readRow(row) {
          const day = dayKey(requireColumn(row, 'day'));
          const high = Number(requireColumn(row, 'high'));
          const low = Number(requireColumn(row, 'low'));
          if (!Number.isFinite(high) || !Number.isFinite(low)) {
            throw new Error('high and low both have to be numbers');
          }
          if (low > high) {
            throw new Error(`low ${low} is above high ${high}`);
          }
          return item({ day, high: fahrenheit(high), low: fahrenheit(low) });
        },
        write(observations) {
          for (const observation of observations) {
            context.weather.recordObservation(stationId, observation, at);
          }
          return observations.length;
        },
      });

      emit(deps.writer, globalOptionsOf(weather).format, { stationId, ...outcome }, () =>
        [summaryLine(outcome), ...problemLines(outcome)].join('\n'),
      );
    });

  weather
    .command('degree-days <stationId>')
    .description('degree days over a range, with the gaps named')
    .option('--from <day>', 'first day')
    .option('--to <day>', 'last day')
    .action((stationId: string, options: { from?: string; to?: string }) => {
      const { context } = deps.runtime();
      const to = options.to ? dayKey(options.to) : currentDay(context);
      const from = options.from ? dayKey(options.from) : addDays(to, -30);
      const ledger = context.weather.loadLedger(stationId, from, to);
      const summary = {
        stationId,
        from,
        to,
        total: ledger.accumulate(from, to),
        recorded: ledger.size,
        missing: ledger.missing(from, to),
      };
      emit(deps.writer, globalOptionsOf(weather).format, summary, () =>
        [
          `${stationId}  ${from} to ${to}`,
          `${summary.total.toFixed(1)} heating degree days over ${summary.recorded} days`,
          summary.missing.length === 0
            ? 'no gaps'
            : `${summary.missing.length} days missing: ${summary.missing.slice(0, 10).join(', ')}` +
              (summary.missing.length > 10 ? ' ...' : ''),
        ].join('\n'),
      );
    });
}
