import { describe, expect, it } from 'vitest';
import {
  ComplianceItem,
  compareItems,
  inspectTank,
  inspectTruck,
  isBlocking,
  leakCheckDueOn,
} from '../../../src/core/compliance';
import { dayKey } from '../../../src/util/dates';
import { makeTank } from '../../../src/model/tank';
import { makeTruck } from '../../../src/model/fleet';

function tank(overrides: Record<string, unknown> = {}) {
  return makeTank({
    id: 't-1',
    customerId: 'c-1',
    serialNumber: 'TR-1',
    waterCapacity: 500,
    owner: 'company',
    installedOn: '2019-09-20',
    lastLeakCheckOn: '2021-06-01',
    ...overrides,
  } as never);
}

function truck(overrides: Record<string, unknown> = {}) {
  return makeTruck({
    id: 'b-4',
    unitNumber: 'B-4',
    waterCapacity: 3000,
    meterSealedOn: '2025-03-04',
    ...overrides,
  } as never);
}

describe('leakCheckDueOn', () => {
  it('is five years from the last one', () => {
    expect(leakCheckDueOn(tank(), 365 * 5)).toBe('2026-05-31');
  });

  it('is unknown when there has never been one', () => {
    const { lastLeakCheckOn: _none, ...bare } = tank();
    expect(leakCheckDueOn(bare, 365 * 5)).toBeUndefined();
  });
});

describe('inspectTank', () => {
  it('is quiet when the check is a long way off', () => {
    expect(inspectTank(tank(), dayKey('2023-01-01'))).toEqual([]);
  });

  it('raises a watch inside the notice window', () => {
    const items = inspectTank(tank(), dayKey('2026-05-01'));
    expect(items[0]).toMatchObject({ kind: 'leak_check_due', severity: 'watch', daysOut: 30 });
  });

  it('raises it to due inside two weeks', () => {
    expect(inspectTank(tank(), dayKey('2026-05-25'))[0]?.severity).toBe('due');
  });

  it('blocks once it is past', () => {
    const items = inspectTank(tank(), dayKey('2026-07-01'));
    expect(items[0]).toMatchObject({ kind: 'leak_check_overdue', severity: 'blocking' });
    expect(items[0]?.message).toMatch(/due a leak check on 2026-05-31/);
  });

  it('blocks a tank that has never been checked', () => {
    const { lastLeakCheckOn: _none, ...bare } = tank();
    const items = inspectTank(bare, dayKey('2025-01-01'));
    expect(items[0]).toMatchObject({ kind: 'never_leak_checked', severity: 'blocking' });
  });

  it('says nothing about a tank that has come out', () => {
    expect(inspectTank(tank({ removedOn: '2024-01-01' }), dayKey('2026-07-01'))).toEqual([]);
  });

  it('still reports a tank due to come out later', () => {
    expect(inspectTank(tank({ removedOn: '2027-01-01' }), dayKey('2026-07-01'))).toHaveLength(1);
  });

  it('takes a different interval and notice window', () => {
    const items = inspectTank(tank(), dayKey('2022-07-01'), {
      leakCheckIntervalDays: 365,
      noticeDays: 10,
    });
    expect(items[0]?.kind).toBe('leak_check_overdue');
  });

  it('refuses a window that is not positive', () => {
    expect(() => inspectTank(tank(), dayKey('2025-01-01'), { noticeDays: 0 })).toThrowError(
      /notice days/,
    );
    expect(() =>
      inspectTank(tank(), dayKey('2025-01-01'), { leakCheckIntervalDays: 0 }),
    ).toThrowError(/leak check interval/);
  });
});

describe('inspectTruck', () => {
  it('is quiet on a fresh seal', () => {
    expect(inspectTruck(truck(), dayKey('2025-04-01'))).toEqual([]);
  });

  it('warns as the seal runs down', () => {
    const items = inspectTruck(truck(), dayKey('2026-02-01'));
    expect(items[0]).toMatchObject({ kind: 'meter_seal_due', severity: 'watch' });
  });

  it('blocks once it has lapsed', () => {
    const items = inspectTruck(truck(), dayKey('2026-04-01'));
    expect(items[0]).toMatchObject({ kind: 'meter_seal_expired', severity: 'blocking' });
    expect(items[0]?.message).toMatch(/lapsed on 2026-03-04/);
  });

  it('blocks a truck with no seal on file', () => {
    const { meterSealedOn: _none, ...bare } = truck();
    expect(inspectTruck(bare, dayKey('2025-04-01'))[0]?.kind).toBe('meter_seal_expired');
  });

  it('says nothing about a retired truck', () => {
    expect(inspectTruck(truck({ active: false }), dayKey('2026-04-01'))).toEqual([]);
  });
});

describe('sorting and summarising', () => {
  const items: ComplianceItem[] = [
    {
      kind: 'leak_check_due',
      severity: 'watch',
      subjectId: 'b',
      subjectKind: 'tank',
      daysOut: 30,
      message: '',
    },
    {
      kind: 'meter_seal_expired',
      severity: 'blocking',
      subjectId: 'a',
      subjectKind: 'truck',
      daysOut: -10,
      message: '',
    },
    {
      kind: 'leak_check_due',
      severity: 'due',
      subjectId: 'c',
      subjectKind: 'tank',
      daysOut: 5,
      message: '',
    },
  ];

  it('puts the blocking ones first', () => {
    expect([...items].sort(compareItems).map((item) => item.subjectId)).toEqual(['a', 'c', 'b']);
  });

  it('breaks a tie on the subject id', () => {
    const tied: ComplianceItem[] = [
      {
        kind: 'leak_check_due',
        severity: 'due',
        subjectId: 'z',
        subjectKind: 'tank',
        daysOut: 5,
        message: '',
      },
      {
        kind: 'leak_check_due',
        severity: 'due',
        subjectId: 'a',
        subjectKind: 'tank',
        daysOut: 5,
        message: '',
      },
    ];
    expect(tied.sort(compareItems)[0]?.subjectId).toBe('a');
  });

  it('reports whether anything blocks', () => {
    expect(isBlocking(items)).toBe(true);
    expect(isBlocking(items.filter((item) => item.severity !== 'blocking'))).toBe(false);
    expect(isBlocking([])).toBe(false);
  });
});
