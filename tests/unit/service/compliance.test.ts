import { afterEach, describe, expect, it } from 'vitest';
import { ComplianceService } from '../../../src/service/compliance';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeTruck } from '../../../src/model/fleet';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2026-05-01' });
  scenario.context.tanks.recordLeakCheck(scenario.tank.id, dayKey('2021-06-01'));
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000, meterSealedOn: '2025-06-01' }),
  );
  return { scenario, service: new ComplianceService(scenario.context) };
}

describe('report', () => {
  it('picks up a tank due a leak check and a truck due a seal', () => {
    const { service } = setup();
    const report = service.report();
    expect(report.items.map((item) => item.kind).sort()).toEqual([
      'leak_check_due',
      'meter_seal_due',
    ]);
    expect(report.asOf).toBe('2026-05-01');
  });

  it('counts by severity', () => {
    const { service } = setup();
    const report = service.report({ asOf: dayKey('2026-07-01') });
    expect(report.blocking).toBe(2);
    expect(report.due + report.watch).toBe(0);
  });

  it('puts the blocking items at the top', () => {
    const { service } = setup();
    const report = service.report({ asOf: dayKey('2026-06-15') });
    expect(report.items[0]?.severity).toBe('blocking');
  });

  it('is quiet when everything is current', () => {
    const { scenario, service } = setup();
    scenario.context.tanks.recordLeakCheck(scenario.tank.id, dayKey('2026-01-01'));
    scenario.context.fleet.recordMeterSeal('b-4', dayKey('2026-04-01'));
    expect(service.report().items).toEqual([]);
  });

  it('takes a narrower notice window', () => {
    const { service } = setup();
    expect(service.report({ window: { noticeDays: 5 } }).items).toEqual([]);
  });

  it('ignores a tank that has come out', () => {
    const { scenario, service } = setup();
    scenario.context.tanks.remove(scenario.tank.id, dayKey('2026-01-01'));
    expect(service.report().items.map((item) => item.subjectKind)).toEqual(['truck']);
  });
});

describe('canFill', () => {
  it('allows a tank that is current', () => {
    const { scenario, service } = setup();
    scenario.context.tanks.recordLeakCheck(scenario.tank.id, dayKey('2026-01-01'));
    expect(service.canFill(scenario.tank.id)).toEqual({ allowed: true, reasons: [] });
  });

  it('refuses one that is overdue', () => {
    const { scenario, service } = setup();
    const result = service.canFill(scenario.tank.id, dayKey('2026-07-01'));
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toMatch(/due a leak check/);
  });

  it('refuses one on an account that is on hold', () => {
    const { scenario, service } = setup();
    scenario.context.tanks.recordLeakCheck(scenario.tank.id, dayKey('2026-01-01'));
    scenario.context.customers.setHold(scenario.customer.id, 'past due 90');
    const result = service.canFill(scenario.tank.id);
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toMatch(/on hold: past due 90/);
  });

  it('refuses a tank it does not know', () => {
    const { service } = setup();
    expect(() => service.canFill('t-nope')).toThrowError(/no tank with id/);
  });
});

describe('interruptions', () => {
  it('finds a fill that started from an empty tank', () => {
    const { scenario, service } = setup();
    scenario.fill('2026-01-14', 380, { gaugeBefore: 3 });
    const records = service.interruptions(dayKey('2026-01-01'), dayKey('2026-02-01'));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ day: '2026-01-14', gaugeBefore: 3, cleared: false });
  });

  it('ignores an ordinary fill', () => {
    const { scenario, service } = setup();
    scenario.fill('2026-01-14', 280, { gaugeBefore: 25 });
    expect(service.interruptions(dayKey('2026-01-01'), dayKey('2026-02-01'))).toEqual([]);
  });

  it('marks it cleared once a later check is on file', () => {
    const { scenario, service } = setup();
    scenario.fill('2026-01-14', 380, { gaugeBefore: 3 });
    scenario.context.tanks.recordLeakCheck(scenario.tank.id, dayKey('2026-01-15'));
    expect(service.interruptions(dayKey('2026-01-01'), dayKey('2026-02-01'))[0]?.cleared).toBe(
      true,
    );
  });

  it('stays inside the range it was asked about', () => {
    const { scenario, service } = setup();
    scenario.fill('2025-01-14', 380, { gaugeBefore: 3 });
    expect(service.interruptions(dayKey('2026-01-01'), dayKey('2026-02-01'))).toEqual([]);
  });
});

describe('groundedTrucks', () => {
  it('is empty while the seal holds', () => {
    expect(setup().service.groundedTrucks()).toEqual([]);
  });

  it('names a truck whose seal has lapsed', () => {
    const { service } = setup();
    const grounded = service.groundedTrucks(dayKey('2026-07-01'));
    expect(grounded).toHaveLength(1);
    expect(grounded[0]).toMatchObject({ unitNumber: 'B-4' });
    expect(grounded[0]?.reason).toMatch(/lapsed/);
  });

  it('ignores a retired truck', () => {
    const { scenario, service } = setup();
    scenario.context.fleet.retireTruck('b-4');
    expect(service.groundedTrucks(dayKey('2026-07-01'))).toEqual([]);
  });
});
