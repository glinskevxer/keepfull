import { DayKey, addDays, daysBetween } from '../util/dates';
import { Tank } from '../model/tank';
import { Truck, meterSealExpiresOn } from '../model/fleet';
import { assertPositive } from '../util/assert';

/**
 * The dates somebody has to answer for.
 *
 * None of this is optional and none of it is negotiable with a customer. A tank
 * that lost pressure has to be leak checked before it goes back in service. A
 * truck whose meter seal has lapsed cannot write a ticket that is legal for
 * trade. A portable cylinder past its requalification date cannot be filled at
 * all, whatever the customer says about it being nearly new.
 */

export type ComplianceKind =
  | 'leak_check_due'
  | 'leak_check_overdue'
  | 'never_leak_checked'
  | 'meter_seal_due'
  | 'meter_seal_expired';

export type Severity = 'watch' | 'due' | 'blocking';

export interface ComplianceItem {
  readonly kind: ComplianceKind;
  readonly severity: Severity;
  readonly subjectId: string;
  readonly subjectKind: 'tank' | 'truck';
  readonly dueOn?: DayKey;
  readonly daysOut?: number;
  readonly message: string;
}

export interface ComplianceWindow {
  /** How far ahead something counts as coming due. */
  readonly noticeDays?: number;
  /** How often a tank system is leak checked. */
  readonly leakCheckIntervalDays?: number;
}

const DEFAULTS = {
  noticeDays: 45,
  leakCheckIntervalDays: 365 * 5,
} as const;

export function leakCheckDueOn(tank: Tank, intervalDays: number): DayKey | undefined {
  return tank.lastLeakCheckOn ? addDays(tank.lastLeakCheckOn, intervalDays) : undefined;
}

export function inspectTank(
  tank: Tank,
  on: DayKey,
  window: ComplianceWindow = {},
): ComplianceItem[] {
  const noticeDays = window.noticeDays ?? DEFAULTS.noticeDays;
  const interval = window.leakCheckIntervalDays ?? DEFAULTS.leakCheckIntervalDays;
  assertPositive(noticeDays, 'notice days');
  assertPositive(interval, 'leak check interval');
  const items: ComplianceItem[] = [];

  if (tank.removedOn !== undefined && tank.removedOn <= on) {
    return items;
  }

  const dueOn = leakCheckDueOn(tank, interval);
  if (dueOn === undefined) {
    items.push({
      kind: 'never_leak_checked',
      severity: 'blocking',
      subjectId: tank.id,
      subjectKind: 'tank',
      message: `tank ${tank.id} has no leak check on file and cannot be filled`,
    });
    return items;
  }
  const daysOut = daysBetween(on, dueOn);
  if (daysOut < 0) {
    items.push({
      kind: 'leak_check_overdue',
      severity: 'blocking',
      subjectId: tank.id,
      subjectKind: 'tank',
      dueOn,
      daysOut,
      message: `tank ${tank.id} was due a leak check on ${dueOn}`,
    });
  } else if (daysOut <= noticeDays) {
    items.push({
      kind: 'leak_check_due',
      severity: daysOut <= 14 ? 'due' : 'watch',
      subjectId: tank.id,
      subjectKind: 'tank',
      dueOn,
      daysOut,
      message: `tank ${tank.id} is due a leak check on ${dueOn}`,
    });
  }
  return items;
}

export function inspectTruck(
  truck: Truck,
  on: DayKey,
  window: ComplianceWindow = {},
): ComplianceItem[] {
  const noticeDays = window.noticeDays ?? DEFAULTS.noticeDays;
  const items: ComplianceItem[] = [];
  if (!truck.active) {
    return items;
  }
  const expires = meterSealExpiresOn(truck);
  if (expires === undefined) {
    items.push({
      kind: 'meter_seal_expired',
      severity: 'blocking',
      subjectId: truck.id,
      subjectKind: 'truck',
      message: `truck ${truck.unitNumber} has no meter seal on file`,
    });
    return items;
  }
  const daysOut = daysBetween(on, expires);
  if (daysOut < 0) {
    items.push({
      kind: 'meter_seal_expired',
      severity: 'blocking',
      subjectId: truck.id,
      subjectKind: 'truck',
      dueOn: expires,
      daysOut,
      message: `the meter seal on ${truck.unitNumber} lapsed on ${expires}`,
    });
  } else if (daysOut <= noticeDays) {
    items.push({
      kind: 'meter_seal_due',
      severity: daysOut <= 14 ? 'due' : 'watch',
      subjectId: truck.id,
      subjectKind: 'truck',
      dueOn: expires,
      daysOut,
      message: `the meter seal on ${truck.unitNumber} runs out on ${expires}`,
    });
  }
  return items;
}

/** Blocking items first, then by how overdue they are. */
export function compareItems(left: ComplianceItem, right: ComplianceItem): number {
  const rank: Record<Severity, number> = { blocking: 0, due: 1, watch: 2 };
  if (rank[left.severity] !== rank[right.severity]) {
    return rank[left.severity] - rank[right.severity];
  }
  const leftDays = left.daysOut ?? Number.NEGATIVE_INFINITY;
  const rightDays = right.daysOut ?? Number.NEGATIVE_INFINITY;
  if (leftDays !== rightDays) {
    return leftDays - rightDays;
  }
  return left.subjectId < right.subjectId ? -1 : 1;
}

export function isBlocking(items: readonly ComplianceItem[]): boolean {
  return items.some((item) => item.severity === 'blocking');
}
