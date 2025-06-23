import { afterEach, describe, expect, it } from 'vitest';
import { WeatherRepository } from '../../../src/db/repo/weather-repo';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { fahrenheit } from '../../../src/core/units';
import { makeStation } from '../../../src/model/station';

afterEach(closeTestDatabases);

const ithaca = makeStation({
  id: 'KITH',
  name: 'Ithaca Tompkins Regional',
  latitude: 42.4908,
  longitude: -76.4584,
  elevationFeet: 1099,
});

const ridge = makeStation({
  id: 'KELM',
  name: 'Elmira Corning Regional',
  latitude: 42.1599,
  longitude: -76.8916,
  elevationFeet: 954,
  baseTemperature: 60,
  active: false,
});

function repo(): WeatherRepository {
  return new WeatherRepository(testDatabase());
}

describe('stations', () => {
  it('saves and reads one back', () => {
    const weather = repo();
    weather.saveStation(ithaca);
    expect(weather.getStation('KITH')).toEqual(ithaca);
  });

  it('reports nothing for a station it does not have', () => {
    expect(repo().findStation('KBUF')).toBeUndefined();
  });

  it('throws for a station it does not have when the caller demands one', () => {
    expect(() => repo().getStation('KBUF')).toThrowError(/no station with id KBUF/);
  });

  it('updates on a second save rather than failing', () => {
    const weather = repo();
    weather.saveStation(ithaca);
    weather.saveStation({ ...ithaca, name: 'Ithaca Airport' });
    expect(weather.getStation('KITH').name).toBe('Ithaca Airport');
    expect(weather.listStations()).toHaveLength(1);
  });

  it('lists in identifier order and can skip the retired ones', () => {
    const weather = repo();
    weather.saveStation(ithaca);
    weather.saveStation(ridge);
    expect(weather.listStations().map((s) => s.id)).toEqual(['KELM', 'KITH']);
    expect(weather.listStations({ activeOnly: true }).map((s) => s.id)).toEqual(['KITH']);
  });

  it('keeps a station specific base temperature', () => {
    const weather = repo();
    weather.saveStation(ridge);
    expect(weather.getStation('KELM').baseTemperature).toBe(60);
  });

  it('deletes, and says whether there was anything to delete', () => {
    const weather = repo();
    weather.saveStation(ithaca);
    expect(weather.deleteStation('KITH')).toBe(true);
    expect(weather.deleteStation('KITH')).toBe(false);
  });
});

describe('observations', () => {
  const at = new Date('2025-01-15T06:00:00Z');

  it('records and counts them', () => {
    const weather = repo();
    weather.saveStation(ithaca);
    weather.recordObservation(
      'KITH',
      { day: dayKey('2025-01-14'), high: fahrenheit(30), low: fahrenheit(12) },
      at,
    );
    expect(weather.countObservations('KITH')).toBe(1);
  });

  it('overwrites a revised day instead of adding a second row', () => {
    const weather = repo();
    weather.saveStation(ithaca);
    const day = dayKey('2025-01-14');
    weather.recordObservation('KITH', { day, high: fahrenheit(30), low: fahrenheit(12) }, at);
    weather.recordObservation('KITH', { day, high: fahrenheit(33), low: fahrenheit(14) }, at);
    expect(weather.countObservations('KITH')).toBe(1);
    expect(weather.loadLedger('KITH', day, day).get(day)?.mean).toBe(23.5);
  });

  it('names the latest day it holds', () => {
    const weather = repo();
    weather.saveStation(ithaca);
    for (const day of ['2025-01-14', '2025-01-16', '2025-01-15']) {
      weather.recordObservation(
        'KITH',
        { day: dayKey(day), high: fahrenheit(30), low: fahrenheit(12) },
        at,
      );
    }
    expect(weather.latestObservationDay('KITH')).toBe('2025-01-16');
  });

  it('has no latest day for a station with no weather', () => {
    const weather = repo();
    weather.saveStation(ithaca);
    expect(weather.latestObservationDay('KITH')).toBeUndefined();
    expect(weather.countObservations('KITH')).toBe(0);
  });

  it('refuses an observation for a station that is not there', () => {
    expect(() =>
      repo().recordObservation(
        'KBUF',
        { day: dayKey('2025-01-14'), high: fahrenheit(30), low: fahrenheit(12) },
        at,
      ),
    ).toThrowError();
  });

  it('takes the observations with the station when it is deleted', () => {
    const weather = repo();
    weather.saveStation(ithaca);
    weather.recordObservation(
      'KITH',
      { day: dayKey('2025-01-14'), high: fahrenheit(30), low: fahrenheit(12) },
      at,
    );
    weather.deleteStation('KITH');
    expect(weather.countObservations('KITH')).toBe(0);
  });
});

describe('loadLedger', () => {
  const at = new Date('2025-01-15T06:00:00Z');

  it('builds a ledger over the range and nothing outside it', () => {
    const weather = repo();
    weather.saveStation(ithaca);
    for (const day of ['2025-01-10', '2025-01-11', '2025-01-12', '2025-01-13']) {
      weather.recordObservation(
        'KITH',
        { day: dayKey(day), high: fahrenheit(35), low: fahrenheit(15) },
        at,
      );
    }
    const ledger = weather.loadLedger('KITH', dayKey('2025-01-11'), dayKey('2025-01-12'));
    expect(ledger.size).toBe(2);
    expect(ledger.accumulate(dayKey('2025-01-11'), dayKey('2025-01-12'))).toBe(80);
  });

  it('uses the station base temperature', () => {
    const weather = repo();
    weather.saveStation(ridge);
    weather.recordObservation(
      'KELM',
      { day: dayKey('2025-01-11'), high: fahrenheit(55), low: fahrenheit(35) },
      at,
    );
    expect(weather.loadLedger('KELM', dayKey('2025-01-11'), dayKey('2025-01-11')).base).toBe(60);
  });

  it('refuses to build one for a station it does not know', () => {
    expect(() =>
      repo().loadLedger('KBUF', dayKey('2025-01-01'), dayKey('2025-01-02')),
    ).toThrowError(/no station with id KBUF/);
  });
});

describe('normals', () => {
  it('saves, overwrites and reads back', () => {
    const weather = repo();
    weather.saveStation(ithaca);
    weather.saveNormal('KITH', '01-14', 41.5);
    weather.saveNormal('KITH', '01-15', 42);
    weather.saveNormal('KITH', '01-14', 40);
    const normals = weather.loadNormals('KITH');
    expect(normals.size).toBe(2);
    expect(normals.forDay(dayKey('2031-01-14'))).toBe(40);
  });

  it('gives an empty year for a station with none', () => {
    const weather = repo();
    weather.saveStation(ithaca);
    expect(weather.loadNormals('KITH').size).toBe(0);
  });
});
