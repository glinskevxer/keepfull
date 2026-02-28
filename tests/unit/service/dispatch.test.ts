import { afterEach, describe, expect, it } from 'vitest';
import { DispatchService } from '../../../src/service/dispatch';
import { Point } from '../../../src/core/route/distance';
import { buildScenario, seedCleanHistory } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeTruck } from '../../../src/model/fleet';

afterEach(closeTestDatabases);

const yard: Point = { latitude: 42.4432, longitude: -76.5019 };

/** Six clean fills so the tank has a model, burning six gallons a day. */
function withFleet(options: Parameters<typeof buildScenario>[0] = {}) {
  const scenario = buildScenario({ today: '2025-02-10', ...options });
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
  );
  seedCleanHistory(scenario);
  return { scenario, dispatch: new DispatchService(scenario.context, yard) };
}

describe('truckCapacities', () => {
  it('takes every active bobtail', () => {
    const { dispatch } = withFleet();
    expect(dispatch.truckCapacities()).toEqual([{ truckId: 'b-4', gallons: 2350 }]);
  });

  it('leaves out a retired truck', () => {
    const { scenario, dispatch } = withFleet();
    scenario.context.fleet.retireTruck('b-4');
    expect(dispatch.truckCapacities()).toEqual([]);
  });

  it('leaves out a truck whose meter seal has lapsed', () => {
    const { scenario, dispatch } = withFleet();
    scenario.context.fleet.recordMeterSeal('b-4', dayKey('2023-01-01'));
    expect(dispatch.truckCapacities()).toEqual([]);
  });

  it('keeps a truck whose seal is still good', () => {
    const { scenario, dispatch } = withFleet();
    scenario.context.fleet.recordMeterSeal('b-4', dayKey('2025-01-01'));
    expect(dispatch.truckCapacities()).toHaveLength(1);
  });

  it('leaves out the transports', () => {
    const { scenario, dispatch } = withFleet();
    scenario.context.fleet.saveTruck(
      makeTruck({ id: 't-1', unitNumber: 'T-1', kind: 'transport', waterCapacity: 11500 }),
    );
    expect(dispatch.truckCapacities().map((t) => t.truckId)).toEqual(['b-4']);
  });

  it('takes an explicit list when it is given one', () => {
    const { dispatch } = withFleet();
    expect(dispatch.truckCapacities({ truckIds: ['b-4'] })).toHaveLength(1);
  });
});

describe('candidates', () => {
  it('picks up a tank due inside the window', () => {
    const { dispatch } = withFleet();
    const { candidates } = dispatch.candidates({ windowDays: 30 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.reserveDay).toBe('2025-02-16');
  });

  it('leaves a tank alone when it is not due yet', () => {
    const { dispatch } = withFleet();
    const { candidates, skipped } = dispatch.candidates({ windowDays: 1 });
    expect(candidates).toEqual([]);
    expect(skipped.map((s) => s.reason)).toContain('not_due_yet');
  });

  it('sizes the drop off the projected gauge', () => {
    const { dispatch } = withFleet();
    const stop = dispatch.candidates({ windowDays: 30 }).candidates[0]?.stop;
    expect(stop?.gallons).toBeGreaterThan(100);
    expect(stop?.gallons).toBeLessThan(400);
  });

  it('marks a tank already past reserve as overdue', () => {
    const { dispatch } = withFleet({ today: '2025-03-01' });
    const stop = dispatch.candidates({ windowDays: 30 }).candidates[0]?.stop;
    expect(stop?.overdue).toBe(true);
  });

  it('skips a will call account', () => {
    const { scenario, dispatch } = withFleet();
    scenario.context.customers.update({ ...scenario.customer, deliveryMode: 'will_call' });
    expect(dispatch.candidates({ windowDays: 30 }).skipped[0]?.reason).toBe(
      'not_a_forecast_account',
    );
  });

  it('skips an account on hold', () => {
    const { scenario, dispatch } = withFleet();
    scenario.context.customers.setHold(scenario.customer.id, 'past due 90');
    expect(dispatch.candidates({ windowDays: 30 }).skipped[0]?.reason).toBe('account_on_hold');
  });

  it('skips a closed account', () => {
    const { scenario, dispatch } = withFleet();
    scenario.context.customers.close(scenario.customer.id, dayKey('2025-01-01'));
    expect(dispatch.candidates({ windowDays: 30 }).skipped[0]?.reason).toBe('account_closed');
  });

  it('skips a tank with no history to forecast from', () => {
    const { scenario, dispatch } = withFleet();
    scenario.addTank();
    const skipped = dispatch.candidates({ windowDays: 30 }).skipped;
    expect(skipped.map((s) => s.reason)).toContain('no_forecast');
  });
});

describe('plan', () => {
  it('routes the candidates onto the truck', () => {
    const { dispatch } = withFleet();
    const result = dispatch.plan({ windowDays: 30 });
    expect(result.plan.routes[0]?.stops).toHaveLength(1);
    expect(result.day).toBe('2025-02-10');
  });

  it('says so in the log', () => {
    const { scenario, dispatch } = withFleet();
    dispatch.plan({ windowDays: 30 });
    expect(scenario.sink.messages()).toContain('planned the day');
  });

  it('defers everything when no truck is running', () => {
    const { scenario, dispatch } = withFleet();
    scenario.context.fleet.retireTruck('b-4');
    const result = dispatch.plan({ windowDays: 30 });
    expect(result.plan.deferred).toHaveLength(1);
    expect(result.plan.deferred[0]?.reason).toBe('no_trucks');
  });

  it('produces an empty day when nothing is due', () => {
    const { dispatch } = withFleet();
    const result = dispatch.plan({ windowDays: 1 });
    expect(result.candidates).toEqual([]);
    expect(result.plan.totalGallons).toBe(0);
  });
});
