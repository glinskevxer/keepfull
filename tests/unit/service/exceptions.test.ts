import { afterEach, describe, expect, it } from 'vitest';
import { ExceptionService } from '../../../src/service/exceptions';
import { buildScenario, seedCleanHistory } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeTruck } from '../../../src/model/fleet';

afterEach(closeTestDatabases);

function setup(today = '2025-02-10') {
  const scenario = buildScenario({ today });
  scenario.context.tanks.recordLeakCheck(scenario.tank.id, dayKey('2024-01-01'));
  return { scenario, service: new ExceptionService(scenario.context) };
}

/** A second tank that is current on its paperwork, so only the monitor stands out. */
function addCheckedTank(
  scenario: ReturnType<typeof setup>['scenario'],
  overrides: Record<string, unknown> = {},
) {
  const tank = scenario.addTank(overrides);
  scenario.context.tanks.recordLeakCheck(tank.id, dayKey('2024-01-01'));
  return tank;
}

describe('report', () => {
  it('is quiet when the book is in order', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    const report = service.report();
    expect(report.exceptions).toEqual([]);
    expect(report.today).toBe(0);
  });

  it('flags a tank with no usable forecast', () => {
    const { service } = setup();
    const report = service.report();
    expect(report.byKind.tank_cannot_be_forecast).toBe(1);
    expect(report.exceptions[0]?.message).toMatch(/no usable forecast/);
  });

  it('says nothing about a will call tank, which is never forecast', () => {
    const { scenario, service } = setup();
    scenario.context.customers.update({ ...scenario.customer, deliveryMode: 'will_call' });
    expect(service.report().exceptions).toEqual([]);
  });

  it('flags a monitor that has never reported', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    const monitored = addCheckedTank(scenario, { monitorId: 'WT-1' });
    seedCleanHistory(scenario, monitored.id);
    const report = service.report();
    expect(report.byKind.monitor_gone_quiet).toBe(1);
    expect(report.exceptions[0]?.message).toMatch(/has never reported/);
  });

  it('flags a monitor that has gone quiet', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    const monitored = addCheckedTank(scenario, { monitorId: 'WT-1' });
    seedCleanHistory(scenario, monitored.id);
    scenario.context.readings.record({
      id: 'r-1',
      tankId: monitored.id,
      takenOn: dayKey('2025-01-20'),
      gauge: 40 as never,
      source: 'monitor',
      monitorId: 'WT-1',
    });
    expect(service.report().exceptions[0]?.message).toMatch(/quiet 21 days/);
  });

  it('puts an account on hold with a tank due at the very top', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    scenario.context.customers.setHold(scenario.customer.id, 'past due 90');
    const report = service.report({ dueWindowDays: 30 });
    expect(report.exceptions[0]?.kind).toBe('account_on_hold_with_tank_due');
    expect(report.today).toBeGreaterThan(0);
  });

  it('picks up a blocking compliance item', () => {
    const { scenario, service } = setup('2030-01-01');
    seedCleanHistory(scenario);
    const report = service.report();
    expect(report.byKind.compliance_blocking).toBeGreaterThan(0);
  });

  it('picks up a truck whose seal has lapsed', () => {
    const { scenario, service } = setup();
    scenario.context.fleet.saveTruck(
      makeTruck({
        id: 'b-4',
        unitNumber: 'B-4',
        waterCapacity: 3000,
        meterSealedOn: '2023-01-01',
      }),
    );
    const report = service.report();
    expect(report.exceptions.some((entry) => entry.subjectKind === 'truck')).toBe(true);
  });

  it('leaves sizing out unless it is asked for', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    scenario.context.tanks.update({
      ...scenario.context.tanks.get(scenario.tank.id),
      appliances: ['grain_dryer'],
    });
    expect(service.report().byKind.tank_undersized).toBeUndefined();
    expect(service.report({ includeSizing: true }).byKind.tank_undersized).toBe(1);
  });

  it('orders by urgency then by what matters most inside it', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    scenario.context.customers.setHold(scenario.customer.id, 'past due 90');
    const monitored = addCheckedTank(scenario, { monitorId: 'WT-1' });
    seedCleanHistory(scenario, monitored.id);
    const report = service.report({ dueWindowDays: 30 });
    const ranks = report.exceptions.map((entry) => entry.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(report.exceptions[0]?.kind).toBe('account_on_hold_with_tank_due');
  });

  it('ignores a closed account entirely', () => {
    const { scenario, service } = setup();
    scenario.context.customers.close(scenario.customer.id, dayKey('2025-01-01'));
    expect(service.report().exceptions).toEqual([]);
  });

  it('counts what needs doing today apart from the rest', () => {
    const { scenario, service } = setup();
    seedCleanHistory(scenario);
    const monitored = addCheckedTank(scenario, { monitorId: 'WT-1' });
    seedCleanHistory(scenario, monitored.id);
    const report = service.report();
    expect(report.today).toBe(0);
    expect(report.exceptions).toHaveLength(1);
  });
});
