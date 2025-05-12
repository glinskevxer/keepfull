import { assertInRange, assertNonEmpty } from '../util/assert';
import { DEFAULT_BASE_TEMPERATURE } from '../core/degree-days';
import { Fahrenheit, fahrenheit } from '../core/units';
import { InvalidInputError } from '../core/errors';

/**
 * A weather station whose degree days drive some set of accounts.
 *
 * The dealer covers three valleys and the difference between the ridge and the
 * lake shore is worth several hundred degree days across a winter, so accounts
 * are assigned to the nearest station rather than to one figure for the whole
 * territory.
 */
export interface Station {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Feet above sea level, which is most of why the valleys differ. */
  readonly elevationFeet: number;
  readonly baseTemperature: Fahrenheit;
  readonly active: boolean;
}

export interface StationDraft {
  readonly id: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly elevationFeet: number;
  readonly baseTemperature?: number;
  readonly active?: boolean;
}

export function makeStation(draft: StationDraft): Station {
  assertNonEmpty(draft.id, 'station id');
  if (!/^[A-Z0-9]{3,6}$/.test(draft.id)) {
    throw new InvalidInputError(`"${draft.id}" is not a station identifier`, { id: draft.id });
  }
  assertNonEmpty(draft.name, 'station name');
  assertInRange(draft.latitude, -90, 90, 'latitude');
  assertInRange(draft.longitude, -180, 180, 'longitude');
  assertInRange(draft.elevationFeet, -300, 15_000, 'elevation');
  const baseTemperature =
    draft.baseTemperature === undefined
      ? DEFAULT_BASE_TEMPERATURE
      : fahrenheit(assertInRange(draft.baseTemperature, 45, 75, 'base temperature'));
  return {
    id: draft.id,
    name: draft.name,
    latitude: draft.latitude,
    longitude: draft.longitude,
    elevationFeet: draft.elevationFeet,
    baseTemperature,
    active: draft.active ?? true,
  };
}
