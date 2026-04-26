import { Command } from 'commander';
import { BudgetService } from '../../service/budgets';
import { CliDeps, globalOptionsOf } from '../program';
import { Column, emit, gallons, table } from '../output';
import { cents, formatCents, parseCents, parseMills } from '../../util/money';
import { currentDay } from '../../service/context';
import { dayKey } from '../../util/dates';

/** Budget plans from the terminal, which is where the office opens them. */
export function registerBudgetCommands(program: Command, deps: CliDeps): void {
  const budgets = program.command('budgets').description('levelised payment plans');

  budgets
    .command('open <customerId>')
    .description('open a plan for an account')
    .option('--season <year>', 'heating season the plan covers')
    .option('--balance <amount>', 'what the account already owes, or a credit')
    .option('--cushion <percent>', 'allowance on top of the forecast')
    .option('--price <perGallon>', 'override the posted price')
    .action(
      (
        customerId: string,
        options: { season?: string; balance?: string; cushion?: string; price?: string },
      ) => {
        const service = new BudgetService(deps.runtime().context);
        const plan = service.create({
          customerId,
          ...(options.season ? { season: Number(options.season) } : {}),
          ...(options.balance ? { openingBalance: parseCents(options.balance) } : {}),
          ...(options.cushion ? { cushionPercent: Number(options.cushion) } : {}),
          ...(options.price ? { pricePerGallon: parseMills(options.price) } : {}),
        });
        emit(deps.writer, globalOptionsOf(budgets).format, plan, () =>
          [
            `${plan.id}  season ${plan.season}  starting ${plan.startOn}`,
            `forecast ${gallons(plan.forecastGallons)} gal, planned ${gallons(plan.plannedGallons)} gal`,
            `total ${formatCents(plan.total)}, ${plan.instalments.length - 1} payments of ` +
              `${formatCents(plan.monthlyAmount)} then a true up`,
          ].join('\n'),
        );
      },
    );

  budgets
    .command('show <planId>')
    .description('a plan and how it is tracking')
    .action((planId: string) => {
      const { context } = deps.runtime();
      const service = new BudgetService(context);
      const plan = context.budgets.get(planId);
      const health = service.health(planId);
      const columns: Column<(typeof plan.instalments)[number]>[] = [
        { header: '#', get: (row) => String(row.number), align: 'right' },
        { header: 'due', get: (row) => row.dueOn },
        { header: 'amount', get: (row) => formatCents(row.amount), align: 'right' },
        { header: 'paid', get: (row) => row.paidOn ?? '-' },
        { header: 'true up', get: (row) => (row.isTrueUp ? 'yes' : '') },
      ];
      emit(deps.writer, globalOptionsOf(budgets).format, { plan, health }, () =>
        [
          `${plan.id}  ${plan.status}  season ${plan.season}`,
          `burned ${gallons(health.gallonsBurned)} of ${gallons(health.plannedGallons)} planned gallons`,
          `${health.paymentsMade} of ${health.paymentsDue} due payments made` +
            (health.runningShort ? '  RUNNING SHORT' : ''),
          `settlement as it stands ${formatCents(health.projectedSettlement)}`,
          '',
          table(plan.instalments, columns),
        ].join('\n'),
      );
    });

  budgets
    .command('pay <planId> <number> <amount>')
    .description('record a payment against an instalment')
    .option('--on <day>', 'the day it was taken')
    .action((planId: string, number: string, amount: string, options: { on?: string }) => {
      const { context } = deps.runtime();
      const on = options.on ? dayKey(options.on) : currentDay(context);
      const plan = context.budgets.recordPayment(planId, Number(number), on, parseCents(amount));
      emit(deps.writer, globalOptionsOf(budgets).format, plan, () => {
        const paid = plan.instalments.filter((entry) => entry.paidOn !== undefined).length;
        return `payment ${number} recorded on ${on}, ${paid} of ${plan.instalments.length - 1} paid`;
      });
    });

  budgets
    .command('settle <planId>')
    .description('close a plan out against what was actually burned')
    .option('--on <day>', 'the day to settle at')
    .action((planId: string, options: { on?: string }) => {
      const service = new BudgetService(deps.runtime().context);
      const result = service.settle(planId, options.on ? dayKey(options.on) : undefined);
      emit(deps.writer, globalOptionsOf(budgets).format, result, () =>
        result.settlement > 0
          ? `settled, the customer owes ${formatCents(result.settlement)}`
          : `settled, refund ${formatCents(cents(-result.settlement))}`,
      );
    });

  budgets
    .command('at-risk')
    .description('open plans heading for a settlement nobody expects')
    .option('--on <day>', 'pretend today is this day')
    .action((options: { on?: string }) => {
      const service = new BudgetService(deps.runtime().context);
      const rows = service.atRisk(options.on ? dayKey(options.on) : undefined);
      const columns: Column<(typeof rows)[number]>[] = [
        { header: 'plan', get: (row) => row.planId },
        { header: 'account', get: (row) => row.customerId },
        { header: 'burned', get: (row) => gallons(row.gallonsBurned), align: 'right' },
        { header: 'planned', get: (row) => gallons(row.plannedGallons), align: 'right' },
        { header: 'paid', get: (row) => `${row.paymentsMade}/${row.paymentsDue}`, align: 'right' },
        {
          header: 'settlement',
          get: (row) => formatCents(row.projectedSettlement),
          align: 'right',
        },
      ];
      emit(deps.writer, globalOptionsOf(budgets).format, rows, () => table(rows, columns));
    });
}
