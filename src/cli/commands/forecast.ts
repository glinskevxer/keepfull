import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { Column, emit, gallons, table } from '../output';
import { ForecastingService } from '../../service/forecasting';
import { currentDay } from '../../service/context';
import { addDays, dayKey } from '../../util/dates';

/** Forecasting commands. `due` is the one the office runs every morning. */
export function registerForecastCommands(program: Command, deps: CliDeps): void {
  const forecast = program.command('forecast').description('burn rates and projected reserve days');

  forecast
    .command('tank <tankId>')
    .description('project one tank forward')
    .option('--as-of <day>', 'pretend today is this day')
    .option('--horizon <days>', 'how far to project', '120')
    .action((tankId: string, options: { asOf?: string; horizon: string }) => {
      const { context } = deps.runtime();
      const service = new ForecastingService(context);
      const result = service.forTank(tankId, {
        ...(options.asOf ? { asOf: dayKey(options.asOf) } : {}),
        horizonDays: Number(options.horizon),
      });
      emit(deps.writer, globalOptionsOf(forecast).format, result, () =>
        [
          `tank      ${result.tank.id}`,
          `start     ${result.startingPoint.gauge}% on ${result.startingPoint.day} from ${result.startingPoint.source}`,
          `base load ${result.model.baseGallonsPerDay.toFixed(3)} gal/day`,
          `weather   ${result.model.weatherGallonsPerDegreeDay.toFixed(4)} gal per degree day`,
          `k factor  ${result.model.kFactor === undefined ? 'none' : result.model.kFactor.toFixed(2)}`,
          `fit       ${result.model.intervalsUsed} intervals, ${result.model.intervalsRejected} rejected, quality ${result.model.fitQuality.toFixed(3)}`,
          `reserve   ${result.forecast.reserveDay ?? 'not inside the horizon'}`,
          `empty     ${result.forecast.outOfGasDay ?? 'not inside the horizon'}`,
        ].join('\n'),
      );
    });

  forecast
    .command('due')
    .description('tanks due inside a window, soonest first')
    .option('--as-of <day>', 'pretend today is this day')
    .option('--window <days>', 'how far ahead counts as due', '7')
    .action((options: { asOf?: string; window: string }) => {
      const { context } = deps.runtime();
      const service = new ForecastingService(context);
      const asOf = options.asOf ? dayKey(options.asOf) : currentDay(context);
      const window = Number(options.window);
      const rows: {
        tankId: string;
        account: string;
        reserveDay: string;
        gallonsNow: number;
        fitQuality: number;
      }[] = [];
      for (const tank of context.tanks.list({ inServiceOnly: true })) {
        const result = service.tryForTank(tank.id, { asOf });
        const reserveDay = result?.forecast.reserveDay;
        if (!result || reserveDay === undefined) {
          continue;
        }
        const limit = addDays(asOf, window);
        if (reserveDay > limit) {
          continue;
        }
        const onDay = result.forecast.days.find((entry) => entry.day === asOf);
        rows.push({
          tankId: tank.id,
          account: context.customers.get(tank.customerId).accountNumber,
          reserveDay,
          gallonsNow: onDay?.gallonsRemaining ?? 0,
          fitQuality: result.model.fitQuality,
        });
      }
      rows.sort((left, right) => (left.reserveDay < right.reserveDay ? -1 : 1));
      const columns: Column<(typeof rows)[number]>[] = [
        { header: 'tank', get: (row) => row.tankId },
        { header: 'account', get: (row) => row.account },
        { header: 'reserve on', get: (row) => row.reserveDay },
        { header: 'gallons', get: (row) => gallons(row.gallonsNow), align: 'right' },
        { header: 'fit', get: (row) => row.fitQuality.toFixed(2), align: 'right' },
      ];
      emit(deps.writer, globalOptionsOf(forecast).format, rows, () => table(rows, columns));
    });
}
