import { describe, expect, it } from 'vitest';
import {
  TruckLoadDraft,
  closeShift,
  isClosed,
  makeTruckLoad,
  meteredOut,
} from '../../../src/model/truck-load';

const draft: TruckLoadDraft = {
  id: 'ld-1',
  truckId: 'b-4',
  driverId: 'drv-3',
  loadedOn: '2026-01-14',
  plantGross: 2400,
  plantTemperature: 40,
  meterStart: 184_220,
};

function load(overrides: Partial<TruckLoadDraft> = {}) {
  return makeTruckLoad({ ...draft, ...overrides });
}

describe('makeTruckLoad', () => {
  it('corrects the plant gallons to sixty degrees', () => {
    const built = load();
    expect(built.plantGross).toBe(2400);
    expect(built.plantNet).toBeGreaterThan(2400);
  });

  it('defaults to the first load of the day', () => {
    expect(load().sequence).toBe(1);
  });

  it('refuses a sequence that is not a load of the day', () => {
    expect(() => load({ sequence: 0 })).toThrowError(/not a load of the day/);
    expect(() => load({ sequence: 1.5 })).toThrowError(/not a load of the day/);
  });

  it('refuses a day that is not a day', () => {
    expect(() => load({ loadedOn: 'tuesday' })).toThrowError(/day a truck could load/);
  });

  it('refuses a meter that runs backwards', () => {
    expect(() => load({ meterEnd: 184_000 })).toThrowError(/cannot run backwards/);
  });

  it('accepts a closed shift', () => {
    const built = load({ meterEnd: 186_500 });
    expect(isClosed(built)).toBe(true);
    expect(meteredOut(built)).toBe(2280);
  });

  it('reports nothing metered while the shift is open', () => {
    expect(meteredOut(load())).toBeUndefined();
    expect(isClosed(load())).toBe(false);
  });
});

describe('closeShift', () => {
  it('records the closing reading', () => {
    expect(meteredOut(closeShift(load(), 186_500))).toBe(2280);
  });

  it('refuses a closing reading below the opening one', () => {
    expect(() => closeShift(load(), 100)).toThrowError(/cannot run backwards/);
  });

  it('leaves the original alone', () => {
    const original = load();
    closeShift(original, 186_500);
    expect(isClosed(original)).toBe(false);
  });
});
