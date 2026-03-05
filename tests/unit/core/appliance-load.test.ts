import { describe, expect, it } from 'vitest';
import {
  APPLIANCE_LOAD,
  DIVERSITY_FACTOR,
  connectedLoad,
  designLoad,
  estimateLoad,
  gallonsPerHour,
  hoursAtFullFire,
} from '../../../src/core/appliance-load';
import { APPLIANCES } from '../../../src/model/tank';

describe('the table', () => {
  it('has a figure for every appliance the tank model knows', () => {
    for (const appliance of APPLIANCES) {
      expect(APPLIANCE_LOAD[appliance]).toBeGreaterThan(0);
    }
  });

  it('puts the grain dryer well above everything domestic', () => {
    expect(APPLIANCE_LOAD.grain_dryer).toBeGreaterThan(APPLIANCE_LOAD.furnace * 10);
  });
});

describe('connectedLoad', () => {
  it('adds everything up', () => {
    expect(connectedLoad(['furnace', 'water_heater'])).toBe(140_000);
  });

  it('is nothing for a tank with nothing on it', () => {
    expect(connectedLoad([])).toBe(0);
  });
});

describe('designLoad', () => {
  it('is the largest appliance plus a share of the rest', () => {
    expect(designLoad(['furnace', 'water_heater'])).toBeCloseTo(
      100_000 + 40_000 * DIVERSITY_FACTOR,
      6,
    );
  });

  it('is just the appliance when there is only one', () => {
    expect(designLoad(['furnace'])).toBe(100_000);
  });

  it('is nothing for an empty list', () => {
    expect(designLoad([])).toBe(0);
  });

  it('takes a different diversity factor', () => {
    expect(designLoad(['furnace', 'water_heater'], 1)).toBe(140_000);
    expect(designLoad(['furnace', 'water_heater'], 0)).toBe(100_000);
  });

  it('refuses a negative diversity factor', () => {
    expect(() => designLoad(['furnace'], -1)).toThrowError(/diversity factor/);
  });

  it('does not depend on the order the appliances arrive in', () => {
    expect(designLoad(['water_heater', 'furnace'])).toBe(designLoad(['furnace', 'water_heater']));
  });
});

describe('estimateLoad', () => {
  it('names the largest appliance', () => {
    expect(estimateLoad(['water_heater', 'grain_dryer', 'furnace']).largest).toBe('grain_dryer');
  });

  it('reports nothing on an empty tank', () => {
    expect(estimateLoad([])).toMatchObject({
      connectedBtuPerHour: 0,
      designBtuPerHour: 0,
      largest: null,
      appliances: 0,
    });
  });
});

describe('gallonsPerHour and hoursAtFullFire', () => {
  it('turns btu into gallons an hour', () => {
    expect(gallonsPerHour(91_502)).toBeCloseTo(1, 9);
  });

  it('says how long a tank lasts at full fire', () => {
    expect(hoursAtFullFire(100, 91_502)).toBeCloseTo(100, 9);
  });

  it('says forever when nothing is burning', () => {
    expect(hoursAtFullFire(100, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('refuses negative inputs', () => {
    expect(() => gallonsPerHour(-1)).toThrowError(/btu per hour/);
    expect(() => hoursAtFullFire(-1, 100)).toThrowError(/gallons/);
  });
});
