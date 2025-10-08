import { describe, expect, it } from 'vitest';
import {
  HIGHEST_TABLE_TEMPERATURE,
  LOWEST_TABLE_TEMPERATURE,
  REFERENCE_TEMPERATURE,
  correctionFactor,
  correctionSpread,
  tabulatedTemperatures,
  toGrossGallons,
  toNetGallons,
} from '../../../src/core/volume-correction';
import { fahrenheit, grossGallons, netGallons } from '../../../src/core/units';

describe('correctionFactor', () => {
  it('leaves sixty degree liquid alone', () => {
    expect(correctionFactor(REFERENCE_TEMPERATURE)).toBe(1);
  });

  it('shrinks warm liquid', () => {
    expect(correctionFactor(fahrenheit(90))).toBeLessThan(1);
    expect(correctionFactor(fahrenheit(100))).toBeLessThan(correctionFactor(fahrenheit(90)));
  });

  it('grows cold liquid', () => {
    expect(correctionFactor(fahrenheit(20))).toBeGreaterThan(1);
    expect(correctionFactor(fahrenheit(0))).toBeGreaterThan(correctionFactor(fahrenheit(20)));
  });

  it('lands exactly on a tabulated temperature', () => {
    expect(correctionFactor(fahrenheit(90))).toBeCloseTo(0.9731, 10);
    expect(correctionFactor(fahrenheit(-40))).toBeCloseTo(1.1339, 10);
  });

  it('interpolates between two entries', () => {
    const low = correctionFactor(fahrenheit(80));
    const high = correctionFactor(fahrenheit(85));
    expect(correctionFactor(fahrenheit(82.5))).toBeCloseTo((low + high) / 2, 10);
  });

  it('moves smoothly rather than in steps', () => {
    expect(correctionFactor(fahrenheit(88))).not.toBe(correctionFactor(fahrenheit(90)));
    expect(correctionFactor(fahrenheit(88))).toBeGreaterThan(correctionFactor(fahrenheit(90)));
  });

  it('falls the whole way across the table', () => {
    const temperatures = tabulatedTemperatures().filter((value) => value >= 40);
    for (let index = 1; index < temperatures.length; index += 1) {
      expect(correctionFactor(fahrenheit(temperatures[index] as number))).toBeLessThan(
        correctionFactor(fahrenheit(temperatures[index - 1] as number)),
      );
    }
  });

  it('clamps rather than extrapolating past the ends', () => {
    expect(correctionFactor(fahrenheit(-60))).toBe(
      correctionFactor(fahrenheit(LOWEST_TABLE_TEMPERATURE)),
    );
    expect(correctionFactor(fahrenheit(150))).toBe(
      correctionFactor(fahrenheit(HIGHEST_TABLE_TEMPERATURE)),
    );
  });
});

describe('toNetGallons', () => {
  it('bills less than the meter showed on a hot day', () => {
    expect(toNetGallons(grossGallons(300), fahrenheit(90))).toBeCloseTo(291.93, 2);
  });

  it('bills more than the meter showed on a cold day', () => {
    expect(toNetGallons(grossGallons(300), fahrenheit(10))).toBeCloseTo(315.42, 2);
  });

  it('leaves a zero drop at zero', () => {
    expect(toNetGallons(grossGallons(0), fahrenheit(90))).toBe(0);
  });

  it('moves a five hundred gallon fill by less than a gallon over two degrees', () => {
    const at78 = toNetGallons(grossGallons(500), fahrenheit(78));
    const at80 = toNetGallons(grossGallons(500), fahrenheit(80));
    expect(Math.abs(at78 - at80)).toBeLessThan(1);
  });
});

describe('toGrossGallons', () => {
  it('inverts the correction', () => {
    const gross = grossGallons(412.7);
    const temp = fahrenheit(78);
    expect(toGrossGallons(toNetGallons(gross, temp), temp)).toBeCloseTo(gross, 6);
  });
});

describe('correctionSpread', () => {
  it('is negative when the liquid is warm', () => {
    expect(correctionSpread(grossGallons(500), fahrenheit(90))).toBeLessThan(0);
  });

  it('is positive when the liquid is cold', () => {
    expect(correctionSpread(grossGallons(500), fahrenheit(20))).toBeGreaterThan(0);
  });

  it('is zero at the reference temperature', () => {
    expect(correctionSpread(grossGallons(500), REFERENCE_TEMPERATURE)).toBe(0);
  });
});

describe('tabulatedTemperatures', () => {
  it('runs in five degree steps from forty below to a hundred and thirty', () => {
    const temperatures = tabulatedTemperatures();
    expect(temperatures[0]).toBe(-40);
    expect(temperatures[temperatures.length - 1]).toBe(130);
    for (let index = 1; index < temperatures.length; index += 1) {
      expect((temperatures[index] as number) - (temperatures[index - 1] as number)).toBe(5);
    }
  });

  it('covers the sixty degree reference exactly', () => {
    expect(tabulatedTemperatures()).toContain(60);
  });
});

describe('net gallon construction', () => {
  it('refuses a negative net figure built by hand', () => {
    expect(() => netGallons(-1)).toThrowError(/net gallons/);
  });
});
