import { AppContext, currentDay } from './context';
import { BudgetService } from './budgets';
import { ComplianceService } from './compliance';
import { DayKey, addDays, daysBetween } from '../util/dates';
import { ForecastingService } from './forecasting';
import { SILENCE_THRESHOLD_DAYS } from '../jobs/monitor-health';
import { SizingService } from './sizing';
import { isForecast, isOnHold } from '../model/customer';

/**
 * One list of everything wrong.
 *
 * The office had six screens, each of which was right about its own corner and
 * none of which said what to do first. This is the screen that replaced them.
 * The ordering is the whole value: a tank that will run out on Thursday beats a
 * leak check due in a month, however much louder the compliance screen was
 * about the leak check.
 */

export type ExceptionKind =
  | 'tank_cannot_be_forecast'
  | 'monitor_gone_quiet'
  | 'compliance_blocking'
  | 'compliance_due'
  | 'account_on_hold_with_tank_due'
  | 'tank_undersized'
  | 'budget_plan_short';

export type Urgency = 'today' | 'this_week' | 'this_month';

export interface Exception {
  readonly kind: ExceptionKind;
  readonly urgency: Urgency;
  readonly subject: string;
  readonly subjectKind: 'tank' | 'truck' | 'account' | 'plan';
  readonly message: string;
  /** Lower sorts first. Derived, never stored. */
  readonly rank: number;
}

export interface ExceptionReport {
  readonly asOf: DayKey;
  readonly exceptions: Exception[];
  readonly byKind: Record<string, number>;
  readonly today: number;
}

const URGENCY_RANK: Record<Urgency, number> = { today: 0, this_week: 1, this_month: 2 };

const KIND_WEIGHT: Record<ExceptionKind, number> = {
  account_on_hold_with_tank_due: 0,
  monitor_gone_quiet: 1,
  tank_cannot_be_forecast: 2,
  compliance_blocking: 3,
  budget_plan_short: 4,
  tank_undersized: 5,
  compliance_due: 6,
};

export interface ExceptionOptions {
  readonly asOf?: DayKey;
  /** How far ahead a tank counts as due, for the accounts on hold check. */
  readonly dueWindowDays?: number;
  readonly includeSizing?: boolean;
}

export class ExceptionService {
  constructor(private readonly context: AppContext) {}

  report(options: ExceptionOptions = {}): ExceptionReport {
    const asOf = options.asOf ?? currentDay(this.context);
    const dueWindow = options.dueWindowDays ?? 7;
    const found: Exception[] = [];

    const forecasting = new ForecastingService(this.context);
    const compliance = new ComplianceService(this.context);

    for (const tank of this.context.tanks.list({ inServiceOnly: true })) {
      const customer = this.context.customers.get(tank.customerId);
      if (customer.closedOn !== undefined && customer.closedOn < asOf) {
        continue;
      }
      const result = isForecast(customer) ? forecasting.tryForTank(tank.id, { asOf }) : undefined;

      if (isForecast(customer) && !result) {
        found.push(
          make(
            'tank_cannot_be_forecast',
            'this_week',
            tank.id,
            'tank',
            `tank ${tank.id} on ${customer.accountNumber} has no usable forecast`,
          ),
        );
      }

      if (result && isOnHold(customer)) {
        const reserveDay = result.forecast.reserveDay;
        if (reserveDay !== undefined && reserveDay <= addDays(asOf, dueWindow)) {
          found.push(
            make(
              'account_on_hold_with_tank_due',
              'today',
              customer.accountNumber,
              'account',
              `${customer.accountNumber} is on hold and its tank reaches reserve on ${reserveDay}`,
            ),
          );
        }
      }

      if (tank.monitorId !== undefined) {
        const latest = this.context.readings.list({
          tankId: tank.id,
          source: 'monitor',
          limit: 1,
        })[0];
        const silent = latest === undefined ? null : daysBetween(latest.takenOn, asOf);
        if (silent === null || silent > SILENCE_THRESHOLD_DAYS) {
          found.push(
            make(
              'monitor_gone_quiet',
              silent === null ? 'this_week' : 'today',
              tank.id,
              'tank',
              silent === null
                ? `monitor ${tank.monitorId} on tank ${tank.id} has never reported`
                : `monitor ${tank.monitorId} on tank ${tank.id} has been quiet ${silent} days`,
            ),
          );
        }
      }
    }

    for (const item of compliance.report({ asOf }).items) {
      found.push(
        make(
          item.severity === 'blocking' ? 'compliance_blocking' : 'compliance_due',
          item.severity === 'blocking'
            ? 'today'
            : item.severity === 'due'
              ? 'this_week'
              : 'this_month',
          item.subjectId,
          item.subjectKind,
          item.message,
        ),
      );
    }

    if (options.includeSizing) {
      for (const verdict of new SizingService(this.context).undersizedTanks()) {
        found.push(
          make(
            'tank_undersized',
            'this_month',
            verdict.tankId,
            'tank',
            `tank ${verdict.tankId} is ${verdict.waterCapacity} gallons and needs ` +
              `${verdict.recommendedCapacity ?? 'more than we stock'}`,
          ),
        );
      }
    }

    for (const health of new BudgetService(this.context).atRisk(asOf)) {
      found.push(
        make(
          'budget_plan_short',
          'this_month',
          health.planId,
          'plan',
          `plan ${health.planId} has burned ${Math.round(health.gallonsBurned)} of ` +
            `${Math.round(health.plannedGallons)} planned gallons on ${health.paymentsMade} payments`,
        ),
      );
    }

    found.sort((left, right) =>
      left.rank !== right.rank ? left.rank - right.rank : left.subject < right.subject ? -1 : 1,
    );

    const byKind: Record<string, number> = {};
    for (const exception of found) {
      byKind[exception.kind] = (byKind[exception.kind] ?? 0) + 1;
    }

    return {
      asOf,
      exceptions: found,
      byKind,
      today: found.filter((exception) => exception.urgency === 'today').length,
    };
  }
}

function make(
  kind: ExceptionKind,
  urgency: Urgency,
  subject: string,
  subjectKind: Exception['subjectKind'],
  message: string,
): Exception {
  return {
    kind,
    urgency,
    subject,
    subjectKind,
    message,
    rank: URGENCY_RANK[urgency] * 10 + KIND_WEIGHT[kind],
  };
}
