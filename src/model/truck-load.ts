import { DayKey, dayKey, isDayKey } from '../util/dates';
import { Fahrenheit, GrossGallons, NetGallons, fahrenheit, grossGallons } from '../core/units';
import { InvalidInputError } from '../core/errors';
import { assertNonEmpty, assertNonNegative } from '../util/assert';
import { toNetGallons } from '../core/volume-correction';

/**
 * A load onto a bobtail at the plant.
 *
 * The plant meter reading and the truck meter readings are three separate
 * numbers that should agree, and when they do not, which pair disagrees says
 * what went wrong. Plant against truck start to end points at a meter. Truck
 * meter against the ticket total points at paperwork.
 */
export interface TruckLoad {
  readonly id: string;
  readonly truckId: string;
  readonly driverId?: string;
  readonly loadedOn: DayKey;
  /** Which load of the day this was. A busy January day is three. */
  readonly sequence: number;
  readonly plantGross: GrossGallons;
  readonly plantTemperature: Fahrenheit;
  readonly plantNet: NetGallons;
  /** The truck's own totalising meter at the start of the shift. */
  readonly meterStart: number;
  readonly meterEnd?: number;
  readonly note?: string;
}

export interface TruckLoadDraft {
  readonly id: string;
  readonly truckId: string;
  readonly driverId?: string;
  readonly loadedOn: string;
  readonly sequence?: number;
  readonly plantGross: number;
  readonly plantTemperature: number;
  readonly meterStart: number;
  readonly meterEnd?: number;
  readonly note?: string;
}

export function makeTruckLoad(draft: TruckLoadDraft): TruckLoad {
  assertNonEmpty(draft.id, 'load id');
  assertNonEmpty(draft.truckId, 'truck id');
  if (!isDayKey(draft.loadedOn)) {
    throw new InvalidInputError(`"${draft.loadedOn}" is not a day a truck could load`);
  }
  const sequence = draft.sequence ?? 1;
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new InvalidInputError(`load sequence ${sequence} is not a load of the day`);
  }
  const plantGross = grossGallons(draft.plantGross);
  const plantTemperature = fahrenheit(draft.plantTemperature);
  assertNonNegative(draft.meterStart, 'meter start');
  if (draft.meterEnd !== undefined) {
    assertNonNegative(draft.meterEnd, 'meter end');
    if (draft.meterEnd < draft.meterStart) {
      throw new InvalidInputError('a totalising meter cannot run backwards', {
        meterStart: draft.meterStart,
        meterEnd: draft.meterEnd,
      });
    }
  }
  return {
    id: draft.id,
    truckId: draft.truckId,
    ...(draft.driverId ? { driverId: draft.driverId } : {}),
    loadedOn: dayKey(draft.loadedOn),
    sequence,
    plantGross,
    plantTemperature,
    plantNet: toNetGallons(plantGross, plantTemperature),
    meterStart: draft.meterStart,
    ...(draft.meterEnd === undefined ? {} : { meterEnd: draft.meterEnd }),
    ...(draft.note ? { note: draft.note } : {}),
  };
}

/** What the truck's own meter says it pumped out, once the shift is closed. */
export function meteredOut(load: TruckLoad): number | undefined {
  return load.meterEnd === undefined ? undefined : load.meterEnd - load.meterStart;
}

export function isClosed(load: TruckLoad): boolean {
  return load.meterEnd !== undefined;
}

export function closeShift(load: TruckLoad, meterEnd: number): TruckLoad {
  assertNonNegative(meterEnd, 'meter end');
  if (meterEnd < load.meterStart) {
    throw new InvalidInputError('a totalising meter cannot run backwards', {
      meterStart: load.meterStart,
      meterEnd,
    });
  }
  return { ...load, meterEnd };
}
