import { describe, expect, it } from 'vitest';
import { StationDraft, makeStation } from '../../../src/model/station';

const draft: StationDraft = {
  id: 'KITH',
  name: 'Ithaca Tompkins Regional',
  latitude: 42.4908,
  longitude: -76.4584,
  elevationFeet: 1099,
};

function make(overrides: Partial<StationDraft> = {}) {
  return makeStation({ ...draft, ...overrides });
}

describe('makeStation', () => {
  it('defaults to a sixty five degree base and an active station', () => {
    expect(make().baseTemperature).toBe(65);
    expect(make().active).toBe(true);
  });

  it('takes a different base for a territory that runs warm', () => {
    expect(make({ baseTemperature: 60 }).baseTemperature).toBe(60);
  });

  it('refuses a base nobody would set', () => {
    expect(() => make({ baseTemperature: 30 })).toThrowError(/base temperature/);
    expect(() => make({ baseTemperature: 90 })).toThrowError(/base temperature/);
  });

  it('refuses an identifier that is not one', () => {
    expect(() => make({ id: 'ith' })).toThrowError(/not a station identifier/);
    expect(() => make({ id: 'KITHACA1' })).toThrowError(/not a station identifier/);
  });

  it('refuses a blank name', () => {
    expect(() => make({ name: ' ' })).toThrowError(/station name/);
  });

  it('refuses coordinates off the globe', () => {
    expect(() => make({ latitude: 100 })).toThrowError(/latitude/);
    expect(() => make({ longitude: 200 })).toThrowError(/longitude/);
  });

  it('refuses an elevation that is not on this planet', () => {
    expect(() => make({ elevationFeet: 40_000 })).toThrowError(/elevation/);
  });

  it('can be retired', () => {
    expect(make({ active: false }).active).toBe(false);
  });
});
