import { describe, expect, it } from 'vitest';
import {
  APPLIANCES,
  NON_HEATING_APPLIANCES,
  Tank,
  TankDraft,
  burnsForHeat,
  hasMonitor,
  isInService,
  leakCheckDueBy,
  makeTank,
  reserveGallons,
} from '../../../src/model/tank';
import { dayKey } from '../../../src/util/dates';

const draft: TankDraft = {
  id: 't-1',
  customerId: 'c-1',
  serialNumber: 'TR-884102',
  waterCapacity: 500,
  owner: 'company',
  appliances: ['furnace', 'water_heater'],
  installedOn: '2019-09-20',
};

function make(overrides: Partial<TankDraft> = {}): Tank {
  return makeTank({ ...draft, ...overrides });
}

describe('makeTank', () => {
  it('defaults to an above ground setting at the eighty percent limit', () => {
    const tank = make();
    expect(tank.setting).toBe('above_ground');
    expect(tank.geometry.fillLimit).toBe(80);
  });

  it('gives an underground tank a higher filling limit', () => {
    expect(make({ setting: 'underground' }).geometry.fillLimit).toBe(85);
  });

  it('takes an explicit filling limit over the default', () => {
    expect(make({ setting: 'underground', fillLimit: 80 }).geometry.fillLimit).toBe(80);
  });

  it('takes an explicit reserve', () => {
    expect(make({ reservePercent: 30 }).geometry.reservePercent).toBe(30);
  });

  it('copies the appliance list rather than holding the caller array', () => {
    const appliances: TankDraft['appliances'] = ['furnace'];
    const tank = make({ appliances });
    expect(tank.appliances).toEqual(['furnace']);
    expect(tank.appliances).not.toBe(appliances);
  });

  it('refuses a size that is not on the yard', () => {
    expect(() => make({ waterCapacity: 400 })).toThrowError(/not a tank size on the yard/);
  });

  it('refuses an owner it does not know', () => {
    expect(() => make({ owner: 'leased' as never })).toThrowError(/not a tank owner/);
  });

  it('refuses a setting it does not know', () => {
    expect(() => make({ setting: 'rooftop' as never })).toThrowError(/not a way to set a tank/);
  });

  it('refuses an appliance it does not know', () => {
    expect(() => make({ appliances: ['kiln' as never] })).toThrowError(/not an appliance/);
  });

  it('refuses a removal before the install', () => {
    expect(() => make({ removedOn: '2019-01-01' })).toThrowError(/cannot come out before/);
  });

  it('drops a leak check date that is not a date', () => {
    expect(make({ lastLeakCheckOn: 'last spring' }).lastLeakCheckOn).toBeUndefined();
  });
});

describe('isInService', () => {
  it('is false before the install', () => {
    expect(isInService(make(), dayKey('2019-09-19'))).toBe(false);
  });

  it('includes the removal day', () => {
    const tank = make({ removedOn: '2024-05-02' });
    expect(isInService(tank, dayKey('2024-05-02'))).toBe(true);
    expect(isInService(tank, dayKey('2024-05-03'))).toBe(false);
  });
});

describe('hasMonitor', () => {
  it('reports whether telemetry is attached', () => {
    expect(hasMonitor(make())).toBe(false);
    expect(hasMonitor(make({ monitorId: 'WT-4471' }))).toBe(true);
  });
});

describe('burnsForHeat', () => {
  it('is true when anything heating hangs off the tank', () => {
    expect(burnsForHeat(make({ appliances: ['furnace'] }))).toBe(true);
    expect(burnsForHeat(make({ appliances: ['shop_heater', 'range'] }))).toBe(true);
  });

  it('is false for a cooking and hot water only tank', () => {
    expect(burnsForHeat(make({ appliances: [...NON_HEATING_APPLIANCES] }))).toBe(false);
  });

  it('is false when nothing is listed', () => {
    expect(burnsForHeat(make({ appliances: [] }))).toBe(false);
  });

  it('treats every appliance we know as either heating or not', () => {
    for (const appliance of APPLIANCES) {
      expect(burnsForHeat(make({ appliances: [appliance] }))).toBe(
        !NON_HEATING_APPLIANCES.includes(appliance),
      );
    }
  });
});

describe('leakCheckDueBy', () => {
  it('is five years out from the last one', () => {
    expect(leakCheckDueBy(make({ lastLeakCheckOn: '2021-06-01' }))).toBe('2026-05-31');
  });

  it('is unknown when there has never been one', () => {
    expect(leakCheckDueBy(make())).toBeUndefined();
  });

  it('takes a different interval', () => {
    expect(leakCheckDueBy(make({ lastLeakCheckOn: '2021-06-01' }), 30)).toBe('2021-07-01');
  });
});

describe('reserveGallons', () => {
  it('turns the reserve percent into gallons', () => {
    expect(reserveGallons(make())).toBe(125);
    expect(reserveGallons(make({ waterCapacity: 1000, reservePercent: 20 }))).toBe(200);
  });
});
