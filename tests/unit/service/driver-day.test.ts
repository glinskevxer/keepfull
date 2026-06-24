import { afterEach, describe, expect, it } from 'vitest';
import { DriverDayService } from '../../../src/service/driver-day';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeDriver, makeTruck } from '../../../src/model/fleet';
import { makeRoute } from '../../../src/model/route';
import { makeTruckLoad } from '../../../src/model/truck-load';

afterEach(closeTestDatabases);

const yard = { latitude: 42.4432, longitude: -76.5019 };

function setup() {
  const scenario = buildScenario({ today: '2026-01-14', waterCapacity: 1000 });
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
  );
  scenario.context.fleet.saveDriver(
    makeDriver({ id: 'drv-3', name: 'R Vandemark', licenceNumber: 'NY-1' }),
  );
  return { scenario, service: new DriverDayService(scenario.context) };
}

function aRoute(
  scenario: ReturnType<typeof setup>['scenario'],
  overrides: Record<string, unknown> = {},
) {
  return makeRoute({
    id: 'rt-1',
    truckId: 'b-4',
    driverId: 'drv-3',
    runOn: '2026-01-14',
    plannedMiles: 40,
    stops: [
      {
        id: 'rt-1-s1',
        tankId: scenario.tank.id,
        customerId: scenario.customer.id,
        plannedGallons: 300,
        outcome: 'delivered',
      },
    ],
    ...overrides,
  } as never);
}

describe('forDriver', () => {
  it('is quiet on a day the driver did nothing', () => {
    const { service } = setup();
    const day = service.forDriver('drv-3');
    expect(day).toMatchObject({ stops: 0, grossGallons: 0, fillRate: null, gallonsPerStop: null });
  });

  it('adds up the tickets', () => {
    const { scenario, service } = setup();
    scenario.fill('2026-01-14', 300, {
      meterTemperature: 60,
      driverId: 'drv-3',
      gaugeBefore: 20,
      gaugeAfter: 50,
    });
    scenario.fill('2026-01-14', 200, {
      meterTemperature: 60,
      driverId: 'drv-3',
      gaugeBefore: 50,
      gaugeAfter: 70,
    });
    const day = service.forDriver('drv-3');
    expect(day.grossGallons).toBe(500);
    expect(day.gallonsPerStop).toBe(250);
  });

  it('compares delivered against planned', () => {
    const { scenario, service } = setup();
    scenario.context.routes.save(aRoute(scenario));
    scenario.fill('2026-01-14', 300, {
      meterTemperature: 60,
      driverId: 'drv-3',
      gaugeBefore: 20,
      gaugeAfter: 50,
    });
    const day = service.forDriver('drv-3');
    expect(day.plannedGallons).toBe(300);
    expect(day.fillRate).toBe(1);
    expect(day.gallonsPerMile).toBe(7.5);
  });

  it('counts the stops the driver could not make', () => {
    const { scenario, service } = setup();
    scenario.context.routes.save(aRoute(scenario));
    scenario.context.routes.settleStop('rt-1-s1', 'no_access');
    const day = service.forDriver('drv-3');
    expect(day.missed).toBe(1);
    expect(day.flags).toContain('1 stops not made');
  });

  it('flags a day that came in well under plan', () => {
    const { scenario, service } = setup();
    scenario.context.routes.save(aRoute(scenario));
    scenario.fill('2026-01-14', 100, {
      meterTemperature: 60,
      driverId: 'drv-3',
      gaugeBefore: 20,
      gaugeAfter: 30,
    });
    expect(service.forDriver('drv-3').flags).toContain('delivered well under what was planned');
  });

  it('says what came back on the truck', () => {
    const { scenario, service } = setup();
    scenario.context.loads.insert(
      makeTruckLoad({
        id: 'ld-1',
        truckId: 'b-4',
        driverId: 'drv-3',
        loadedOn: '2026-01-14',
        plantGross: 600,
        plantTemperature: 60,
        meterStart: 100_000,
        meterEnd: 100_500,
      }),
    );
    scenario.fill('2026-01-14', 500, {
      meterTemperature: 60,
      driverId: 'drv-3',
      gaugeBefore: 10,
      gaugeAfter: 60,
    });
    const day = service.forDriver('drv-3');
    expect(day.returnedGallons).toBe(100);
    expect(day.flags).not.toContain('the truck meter and the tickets disagree');
  });

  it('flags a meter that does not agree with the tickets', () => {
    const { scenario, service } = setup();
    scenario.context.loads.insert(
      makeTruckLoad({
        id: 'ld-1',
        truckId: 'b-4',
        driverId: 'drv-3',
        loadedOn: '2026-01-14',
        plantGross: 600,
        plantTemperature: 60,
        meterStart: 100_000,
        meterEnd: 100_500,
      }),
    );
    scenario.fill('2026-01-14', 300, {
      meterTemperature: 60,
      driverId: 'drv-3',
      gaugeBefore: 10,
      gaugeAfter: 40,
    });
    expect(service.forDriver('drv-3').flags).toContain('the truck meter and the tickets disagree');
  });

  it('cannot say what came back while the shift is open', () => {
    const { scenario, service } = setup();
    scenario.context.loads.insert(
      makeTruckLoad({
        id: 'ld-1',
        truckId: 'b-4',
        driverId: 'drv-3',
        loadedOn: '2026-01-14',
        plantGross: 600,
        plantTemperature: 60,
        meterStart: 100_000,
      }),
    );
    expect(service.forDriver('drv-3').returnedGallons).toBeNull();
  });

  it('refuses a driver we do not have', () => {
    const { service } = setup();
    expect(() => service.forDriver('drv-nope')).toThrowError(/no driver with id/);
  });
});

describe('forDay', () => {
  it('is empty on a quiet day', () => {
    expect(setup().service.forDay(dayKey('2026-01-14'))).toEqual([]);
  });

  it('covers everybody who did anything', () => {
    const { scenario, service } = setup();
    scenario.context.fleet.saveDriver(
      makeDriver({ id: 'drv-4', name: 'A Olney', licenceNumber: 'NY-2' }),
    );
    scenario.fill('2026-01-14', 300, {
      meterTemperature: 60,
      driverId: 'drv-3',
      gaugeBefore: 20,
      gaugeAfter: 50,
    });
    scenario.fill('2026-01-14', 200, {
      meterTemperature: 60,
      driverId: 'drv-4',
      gaugeBefore: 50,
      gaugeAfter: 70,
    });
    expect(service.forDay(dayKey('2026-01-14')).map((row) => row.driverId)).toEqual([
      'drv-3',
      'drv-4',
    ]);
  });

  it('leaves out a driver id no longer on file', () => {
    const { scenario, service } = setup();
    scenario.fill('2026-01-14', 300, {
      meterTemperature: 60,
      driverId: 'drv-gone',
      gaugeBefore: 20,
      gaugeAfter: 50,
    });
    expect(service.forDay(dayKey('2026-01-14'))).toEqual([]);
  });
});

describe('drivenOrderMiles', () => {
  it('measures the order the stops are actually in', () => {
    const { scenario, service } = setup();
    scenario.context.routes.save(aRoute(scenario));
    expect(service.drivenOrderMiles('rt-1', yard)).toBeGreaterThan(0);
  });

  it('is nothing for a route with no stops', () => {
    const { scenario, service } = setup();
    scenario.context.routes.save(aRoute(scenario, { stops: [] }));
    expect(service.drivenOrderMiles('rt-1', yard)).toBe(0);
  });
});
