import { afterEach, describe, expect, it } from 'vitest';
import { DeliveryCalendar } from '../../../src/core/calendar';
import { DispatchService } from '../../../src/service/dispatch';
import { RoutingService } from '../../../src/service/routing';
import { buildScenario, seedCleanHistory } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeDriver, makeTruck } from '../../../src/model/fleet';

afterEach(closeTestDatabases);

const yard = { latitude: 42.4432, longitude: -76.5019 };

function setup(today: string, calendar = new DeliveryCalendar()) {
  const scenario = buildScenario({ today, weatherFrom: '2024-01-01', weatherTo: '2027-01-01' });
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
  );
  scenario.context.fleet.saveDriver(
    makeDriver({
      id: 'drv-3',
      name: 'R Vandemark',
      licenceNumber: 'NY-882-441',
      endorsements: ['hazmat', 'tanker'],
    }),
  );
  seedCleanHistory(scenario);
  return {
    scenario,
    dispatch: new DispatchService(scenario.context, yard, calendar),
    routing: new RoutingService(scenario.context, calendar),
  };
}

describe('urgency against the calendar', () => {
  it('names the day a tank actually has to be served by', () => {
    const { dispatch } = setup('2025-02-10');
    const candidate = dispatch.candidates({ windowDays: 30 }).candidates[0];
    expect(candidate?.reserveDay).toBe('2025-02-16');
    // The sixteenth is a Sunday, so the truck has to go on the Saturday.
    expect(candidate?.serveBy).toBe('2025-02-15');
    expect(candidate?.stop.urgency).toBe(5);
  });

  it('leaves a reserve day that already runs alone', () => {
    const { dispatch } = setup('2025-02-12');
    const candidate = dispatch.candidates({ windowDays: 30 }).candidates[0];
    expect(candidate?.serveBy).toBe('2025-02-15');
  });

  it('marks a tank overdue once its serve by day has passed', () => {
    const { dispatch } = setup('2025-02-17');
    const candidate = dispatch.candidates({ windowDays: 30 }).candidates[0];
    expect(candidate?.stop.overdue).toBe(true);
  });
});

describe('committing onto a running day', () => {
  it('runs tomorrow when tomorrow is a working day', () => {
    const { dispatch, routing } = setup('2025-02-10');
    const routes = routing.commit(dispatch.plan({ windowDays: 30 }));
    expect(routes[0]?.runOn).toBe('2025-02-11');
  });

  it('skips the weekend', () => {
    // 2025-02-14 is a Friday, so a plan made then commits to the Saturday,
    // which is a half day in the heating season.
    const { dispatch, routing } = setup('2025-02-14');
    const routes = routing.commit(dispatch.plan({ windowDays: 30 }));
    expect(routes[0]?.runOn).toBe('2025-02-15');
  });

  it('skips a saturday out of season and lands on the monday', () => {
    const summer = new DeliveryCalendar({ saturdaysInSeason: false });
    const { dispatch, routing } = setup('2025-02-14', summer);
    const routes = routing.commit(dispatch.plan({ windowDays: 30 }));
    expect(routes[0]?.runOn).toBe('2025-02-17');
  });

  it('still takes an explicit run day', () => {
    const { dispatch, routing } = setup('2025-02-10');
    const routes = routing.commit(dispatch.plan({ windowDays: 30 }), {
      runOn: dayKey('2025-02-13'),
    });
    expect(routes[0]?.runOn).toBe('2025-02-13');
  });

  it('refuses to release a route dated on a day the trucks do not run', () => {
    const { dispatch, routing } = setup('2025-02-10');
    const routes = routing.commit(dispatch.plan({ windowDays: 30 }), {
      runOn: dayKey('2025-02-16'),
      drivers: { 'b-4': 'drv-3' },
    });
    expect(() => routing.release(routes[0]?.id as string)).toThrowError(
      /trucks do not run on 2025-02-16/,
    );
  });
});
