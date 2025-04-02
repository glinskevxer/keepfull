import { assertInRange, assertNonEmpty } from '../util/assert';
import { DayKey, addDays, dayKey, isDayKey } from '../util/dates';
import { InvalidInputError } from '../core/errors';
import { STOCK_CAPACITIES, TankGeometry, tankGeometry } from '../core/tank-math';

/**
 * The tank, not the account. One account can have several, a house tank and a
 * shop tank on the same yard burn at completely different rates, and each one
 * gets forecast on its own.
 */

export type TankOwner = 'company' | 'customer';

export type TankSetting = 'above_ground' | 'underground' | 'mounded';

export const TANK_SETTINGS: readonly TankSetting[] = ['above_ground', 'underground', 'mounded'];

/** What burns off this tank. It changes the shape of the summer base load. */
export type Appliance =
  | 'furnace'
  | 'boiler'
  | 'water_heater'
  | 'range'
  | 'clothes_dryer'
  | 'fireplace'
  | 'generator'
  | 'grain_dryer'
  | 'poultry_brooder'
  | 'shop_heater';

export const APPLIANCES: readonly Appliance[] = [
  'furnace',
  'boiler',
  'water_heater',
  'range',
  'clothes_dryer',
  'fireplace',
  'generator',
  'grain_dryer',
  'poultry_brooder',
  'shop_heater',
];

/** Appliances that run whether or not it is cold out. */
export const NON_HEATING_APPLIANCES: readonly Appliance[] = [
  'water_heater',
  'range',
  'clothes_dryer',
  'generator',
];

export interface Tank {
  readonly id: string;
  readonly customerId: string;
  readonly serialNumber: string;
  readonly waterCapacity: number;
  readonly owner: TankOwner;
  readonly setting: TankSetting;
  readonly geometry: TankGeometry;
  readonly appliances: readonly Appliance[];
  readonly installedOn: DayKey;
  readonly removedOn?: DayKey;
  /** Identifier of the telemetry monitor on the tank, when there is one. */
  readonly monitorId?: string;
  /** Last leak check, which the code requires after any interruption of service. */
  readonly lastLeakCheckOn?: DayKey;
  readonly notes?: string;
}

export interface TankDraft {
  readonly id: string;
  readonly customerId: string;
  readonly serialNumber: string;
  readonly waterCapacity: number;
  readonly owner: TankOwner;
  readonly setting?: TankSetting;
  readonly fillLimit?: number;
  readonly reservePercent?: number;
  readonly appliances?: readonly Appliance[];
  readonly installedOn: string;
  readonly removedOn?: string;
  readonly monitorId?: string;
  readonly lastLeakCheckOn?: string;
  readonly notes?: string;
}

export function makeTank(draft: TankDraft): Tank {
  assertNonEmpty(draft.id, 'tank id');
  assertNonEmpty(draft.customerId, 'customer id');
  assertNonEmpty(draft.serialNumber, 'serial number');
  if (!STOCK_CAPACITIES.includes(draft.waterCapacity)) {
    throw new InvalidInputError(`${draft.waterCapacity} is not a tank size on the yard`, {
      waterCapacity: draft.waterCapacity,
    });
  }
  if (draft.owner !== 'company' && draft.owner !== 'customer') {
    throw new InvalidInputError(`"${draft.owner}" is not a tank owner`);
  }
  const setting = draft.setting ?? 'above_ground';
  if (!TANK_SETTINGS.includes(setting)) {
    throw new InvalidInputError(`"${setting}" is not a way to set a tank`);
  }
  const appliances = draft.appliances ?? [];
  for (const appliance of appliances) {
    if (!APPLIANCES.includes(appliance)) {
      throw new InvalidInputError(`"${appliance}" is not an appliance we know about`);
    }
  }
  if (!isDayKey(draft.installedOn)) {
    throw new InvalidInputError(`"${draft.installedOn}" is not an installation day`);
  }
  const installedOn = dayKey(draft.installedOn);
  let removedOn: DayKey | undefined;
  if (draft.removedOn !== undefined) {
    if (!isDayKey(draft.removedOn)) {
      throw new InvalidInputError(`"${draft.removedOn}" is not a removal day`);
    }
    removedOn = dayKey(draft.removedOn);
    if (removedOn < installedOn) {
      throw new InvalidInputError('the tank cannot come out before it went in');
    }
  }
  // An underground tank sits at a steadier temperature, so it is allowed a
  // slightly higher filling limit than a tank standing in the July sun.
  const defaultFillLimit = setting === 'above_ground' ? 80 : 85;
  const geometry = tankGeometry(draft.waterCapacity, {
    fillLimit: draft.fillLimit ?? Math.min(defaultFillLimit, 85),
    ...(draft.reservePercent === undefined ? {} : { reservePercent: draft.reservePercent }),
  });
  return {
    id: draft.id,
    customerId: draft.customerId,
    serialNumber: draft.serialNumber,
    waterCapacity: draft.waterCapacity,
    owner: draft.owner,
    setting,
    geometry,
    appliances: [...appliances],
    installedOn,
    ...(removedOn ? { removedOn } : {}),
    ...(draft.monitorId ? { monitorId: draft.monitorId } : {}),
    ...(draft.lastLeakCheckOn && isDayKey(draft.lastLeakCheckOn)
      ? { lastLeakCheckOn: dayKey(draft.lastLeakCheckOn) }
      : {}),
    ...(draft.notes ? { notes: draft.notes } : {}),
  };
}

export function isInService(tank: Tank, on: DayKey): boolean {
  if (on < tank.installedOn) {
    return false;
  }
  return tank.removedOn === undefined || on <= tank.removedOn;
}

export function hasMonitor(tank: Tank): boolean {
  return tank.monitorId !== undefined;
}

/** A tank with no heating appliance has no weather load to forecast against. */
export function burnsForHeat(tank: Tank): boolean {
  return tank.appliances.some((appliance) => !NON_HEATING_APPLIANCES.includes(appliance));
}

export function leakCheckDueBy(tank: Tank, intervalDays = 365 * 5): DayKey | undefined {
  return tank.lastLeakCheckOn ? addDays(tank.lastLeakCheckOn, intervalDays) : undefined;
}

/** Reserve percent expressed in gallons, which is what dispatch actually reasons about. */
export function reserveGallons(tank: Tank): number {
  assertInRange(tank.geometry.reservePercent, 0, 100, 'reserve percent');
  return (tank.waterCapacity * tank.geometry.reservePercent) / 100;
}
