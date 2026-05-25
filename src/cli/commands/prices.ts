import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { Column, emit, table } from '../output';
import { PriceChangeService } from '../../service/price-changes';
import { RateClass } from '../../model/customer';
import { addDays, dayKey, heatingSeason } from '../../util/dates';
import { currentDay } from '../../service/context';
import { formatCents, formatMills, mills, parseMills } from '../../util/money';

/**
 * Moving the price from the terminal. The dry run is the point: the office
 * looks at what a change would do to every tier and to the year before it
 * commits, because a posted price is not something that can be quietly undone.
 */
export function registerPriceCommands(program: Command, deps: CliDeps): void {
  const prices = program.command('prices').description('the posted price and moving it');

  prices
    .command('schedules')
    .description('what is in force and what is coming')
    .option('--class <rateClass>', 'only this rate class')
    .action((options: { class?: string }) => {
      const { context } = deps.runtime();
      const rows = context.pricing
        .listSchedules(options.class ? { rateClass: options.class as RateClass } : {})
        .map((schedule) => ({
          id: schedule.id,
          rateClass: schedule.rateClass,
          effectiveFrom: schedule.effectiveFrom,
          tiers: schedule.tiers
            .map((tier) => `${tier.fromGallons}+ ${formatMills(tier.pricePerGallon)}`)
            .join('  '),
        }));
      const columns: Column<(typeof rows)[number]>[] = [
        { header: 'schedule', get: (row) => row.id },
        { header: 'class', get: (row) => row.rateClass },
        { header: 'from', get: (row) => row.effectiveFrom },
        { header: 'tiers', get: (row) => row.tiers },
      ];
      emit(deps.writer, globalOptionsOf(prices).format, rows, () => table(rows, columns));
    });

  // Two commands rather than one taking a signed number, because a leading
  // minus on an argument is indistinguishable from a flag and every shell in
  // the yard disagrees about how to escape it.
  for (const direction of ['raise', 'cut'] as const) {
    prices
      .command(`${direction} <amount>`)
      .description(
        `${direction === 'raise' ? 'put' : 'take'} an amount ${direction === 'raise' ? 'on' : 'off'} every tier`,
      )
      .option('--from <day>', 'the day it takes effect', undefined)
      .option('--class <rateClass...>', 'only these rate classes')
      .option('--note <text>', 'why')
      .option('--dry-run', 'show what would change without changing it', false)
      .action(
        (
          amount: string,
          options: { from?: string; class?: string[]; note?: string; dryRun: boolean },
        ) => {
          const { context } = deps.runtime();
          const service = new PriceChangeService(context);
          const negative = direction === 'cut';
          const magnitude = parseMills(amount);
          const deltaPerGallon = mills(negative ? -magnitude : magnitude);
          const effectiveFrom = options.from
            ? dayKey(options.from)
            : addDays(currentDay(context), 7);

          if (options.dryRun) {
            const season = heatingSeason(currentDay(context)) - 1;
            const impact = service.impact(deltaPerGallon, season);
            const columns: Column<(typeof impact)[number]>[] = [
              { header: 'class', get: (row) => row.rateClass },
              {
                header: 'gallons last season',
                get: (row) => row.gallonsLastSeason.toFixed(1),
                align: 'right',
              },
              {
                header: 'a year of it',
                get: (row) => formatCents(row.annualImpact),
                align: 'right',
              },
            ];
            emit(deps.writer, globalOptionsOf(prices).format, { effectiveFrom, impact }, () =>
              [
                `${formatMills(mills(Math.abs(deltaPerGallon)))} ${negative ? 'off' : 'on'} every tier from ${effectiveFrom} (dry run)`,
                table(impact, columns),
              ].join('\n'),
            );
            return;
          }

          const result = service.apply({
            deltaPerGallon,
            effectiveFrom,
            ...(options.class ? { rateClasses: options.class as RateClass[] } : {}),
            ...(options.note ? { note: options.note } : {}),
          });
          emit(deps.writer, globalOptionsOf(prices).format, result, () =>
            [
              `${result.changed.length} schedules moved, effective ${result.effectiveFrom}`,
              ...result.changed.map(
                (entry) =>
                  `  ${entry.rateClass}: ${entry.oldTiers.map((tier) => formatMills(mills(tier))).join(' ')}` +
                  ` -> ${entry.newTiers.map((tier) => formatMills(mills(tier))).join(' ')}`,
              ),
              ...result.skipped.map((entry) => `  ${entry.rateClass} skipped: ${entry.reason}`),
            ].join('\n'),
          );
        },
      );
  }
}
