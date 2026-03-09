import { afterEach, describe, expect, it } from 'vitest';
import { ReconciliationService } from '../../../src/service/reconciliation';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeTruck } from '../../../src/model/fleet';
import { makeTruckLoad } from '../../../src/model/truck-load';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2026-01-20', waterCapacity: 1000 });
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
  );
  return { scenario, service: new ReconciliationService(scenario.context) };
}

function load(overrides: Record<string, unknown> = {}) {
  return makeTruckLoad({
    id: 'ld-1',
    truckId: 'b-4',
    loadedOn: '2026-01-14',
    plantGross: 600,
    plantTemperature: 60,
    meterStart: 100_000,
    meterEnd: 100_598,
    ...overrides,
  } as never);
}

describe('forShift', () => {
  it('is clean when the tickets account for the load', () => {
    const { scenario, service } = setup();
    scenario.context.loads.insert(load());
    scenario.fill('2026-01-14', 300, {
      meterTemperature: 60,
      truckId: 'b-4',
      gaugeBefore: 20,
      gaugeAfter: 50,
    });
    scenario.fill('2026-01-14', 296, {
      meterTemperature: 60,
      truckId: 'b-4',
      gaugeBefore: 50,
      gaugeAfter: 80,
    });
    const result = service.forShift('b-4', dayKey('2026-01-14'));
    expect(result.verdict).toBe('clean');
    expect(result.tickets).toBe(2);
    expect(result.plantGallons).toBe(600);
  });

  it('blames the paperwork when a ticket is missing', () => {
    const { scenario, service } = setup();
    scenario.context.loads.insert(load());
    scenario.fill('2026-01-14', 300, {
      meterTemperature: 60,
      truckId: 'b-4',
      gaugeBefore: 20,
      gaugeAfter: 50,
    });
    expect(service.forShift('b-4', dayKey('2026-01-14')).verdict).toBe('paperwork');
  });

  it('blames the meter when the truck says it moved less than the plant put on', () => {
    const { scenario, service } = setup();
    scenario.context.loads.insert(load({ meterEnd: 100_400 }));
    scenario.fill('2026-01-14', 398, {
      meterTemperature: 60,
      truckId: 'b-4',
      gaugeBefore: 20,
      gaugeAfter: 60,
    });
    expect(service.forShift('b-4', dayKey('2026-01-14')).verdict).toBe('meter_drift');
  });

  it('cannot judge a shift nobody closed', () => {
    const { scenario, service } = setup();
    scenario.context.loads.insert(load({ meterEnd: undefined }));
    const result = service.forShift('b-4', dayKey('2026-01-14'));
    expect(result.verdict).toBe('incomplete');
    expect(result.openShifts).toBe(1);
  });

  it('adds two loads of a day together', () => {
    const { scenario, service } = setup();
    scenario.context.loads.insert(load());
    scenario.context.loads.insert(
      load({ id: 'ld-2', sequence: 2, meterStart: 100_598, meterEnd: 101_198 }),
    );
    const result = service.forShift('b-4', dayKey('2026-01-14'));
    expect(result.loads).toBe(2);
    expect(result.plantGallons).toBe(1200);
    expect(result.meteredGallons).toBe(1198);
  });

  it('ignores a voided ticket', () => {
    const { scenario, service } = setup();
    scenario.context.loads.insert(load());
    scenario.fill('2026-01-14', 598, {
      meterTemperature: 60,
      truckId: 'b-4',
      gaugeBefore: 10,
      gaugeAfter: 70,
    });
    scenario.fill('2026-01-14', 999, {
      meterTemperature: 60,
      truckId: 'b-4',
      status: 'void',
      gaugeBefore: 10,
      gaugeAfter: 70,
    });
    expect(service.forShift('b-4', dayKey('2026-01-14')).verdict).toBe('clean');
  });

  it('refuses a truck we do not have', () => {
    const { service } = setup();
    expect(() => service.forShift('b-nope', dayKey('2026-01-14'))).toThrowError(/no truck with id/);
  });

  it('refuses a day the truck did not load', () => {
    const { service } = setup();
    expect(() => service.forShift('b-4', dayKey('2026-01-14'))).toThrowError(
      /no load for truck b-4 on 2026-01-14/,
    );
  });
});

describe('forDay', () => {
  it('covers every truck that loaded', () => {
    const { scenario, service } = setup();
    scenario.context.fleet.saveTruck(
      makeTruck({ id: 'b-7', unitNumber: 'B-7', waterCapacity: 2600 }),
    );
    scenario.context.loads.insert(load());
    scenario.context.loads.insert(load({ id: 'ld-2', truckId: 'b-7' }));
    expect(service.forDay(dayKey('2026-01-14')).map((row) => row.truckId)).toEqual(['b-4', 'b-7']);
  });

  it('is empty on a day nobody loaded', () => {
    expect(setup().service.forDay(dayKey('2026-01-14'))).toEqual([]);
  });
});

describe('drift', () => {
  it('flags a meter that has been off the same way all week', () => {
    const { scenario, service } = setup();
    for (let index = 0; index < 6; index += 1) {
      const day = `2026-01-${String(10 + index).padStart(2, '0')}`;
      scenario.context.loads.insert(load({ id: `ld-${index}`, loadedOn: day, meterEnd: 100_400 }));
      scenario.fill(day, 398, {
        meterTemperature: 60,
        truckId: 'b-4',
        gaugeBefore: 20,
        gaugeAfter: 60,
      });
    }
    const report = service.drift('b-4', dayKey('2026-01-01'), dayKey('2026-01-31'));
    expect(report.days).toBe(6);
    expect(report.direction).toBe('lean');
    expect(report.suspect).toBe(true);
  });

  it('says nothing about a truck that is fine', () => {
    const { scenario, service } = setup();
    scenario.context.loads.insert(load());
    scenario.fill('2026-01-14', 598, {
      meterTemperature: 60,
      truckId: 'b-4',
      gaugeBefore: 10,
      gaugeAfter: 70,
    });
    const report = service.drift('b-4', dayKey('2026-01-01'), dayKey('2026-01-31'));
    expect(report.suspect).toBe(false);
  });

  it('refuses a truck we do not have', () => {
    const { service } = setup();
    expect(() => service.drift('b-nope', dayKey('2026-01-01'), dayKey('2026-01-31'))).toThrowError(
      /no truck with id/,
    );
  });
});
