import { describe, expect, it } from 'vitest';
import {
  PROPANE,
  celsiusToFahrenheit,
  degreeDays,
  fahrenheit,
  fahrenheitToCelsius,
  gallonsToBtu,
  gallonsToPounds,
  gallonsToTherms,
  grossGallons,
  netGallons,
  percent,
  poundsToGallons,
  roundGallons,
  roundPercent,
} from '../../../src/core/units';

describe('constructors', () => {
  it('accepts a zero drop', () => {
    expect(grossGallons(0)).toBe(0);
    expect(netGallons(0)).toBe(0);
  });

  it('refuses a negative drop', () => {
    expect(() => grossGallons(-1)).toThrowError(/gross gallons/);
    expect(() => netGallons(-0.1)).toThrowError(/net gallons/);
  });

  it('refuses degree days below zero', () => {
    expect(() => degreeDays(-2)).toThrowError(/degree days/);
  });

  it('keeps a gauge reading inside the dial', () => {
    expect(percent(80)).toBe(80);
    expect(() => percent(101)).toThrowError(/between 0 and 100/);
    expect(() => percent(-1)).toThrowError(/between 0 and 100/);
  });
});

describe('fahrenheit', () => {
  it('accepts a plausible meter temperature', () => {
    expect(fahrenheit(48)).toBe(48);
    expect(fahrenheit(-40)).toBe(-40);
  });

  it('rejects a reading no meter would produce', () => {
    expect(() => fahrenheit(400)).toThrowError(/outside anything a meter/);
    expect(() => fahrenheit(-120)).toThrowError(/outside anything a meter/);
  });
});

describe('energy conversions', () => {
  it('converts a gallon to its heating value', () => {
    expect(gallonsToBtu(netGallons(1))).toBe(PROPANE.btuPerGallon);
    expect(gallonsToTherms(netGallons(100))).toBeCloseTo(91.502, 3);
  });

  it('converts between gallons and pounds and back', () => {
    const pounds = gallonsToPounds(netGallons(250));
    expect(pounds).toBeCloseTo(1060, 6);
    expect(poundsToGallons(pounds)).toBeCloseTo(250, 9);
  });

  it('refuses negative pounds', () => {
    expect(() => poundsToGallons(-3)).toThrowError(/pounds/);
  });
});

describe('temperature conversions', () => {
  it('round trips', () => {
    expect(fahrenheitToCelsius(celsiusToFahrenheit(20))).toBeCloseTo(20, 9);
  });

  it('matches the freezing point and a warm summer day', () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(40)).toBe(104);
  });

  it('refuses a celsius value that lands outside the meter range', () => {
    expect(() => celsiusToFahrenheit(100)).toThrowError(/outside anything a meter/);
  });
});

describe('rounding', () => {
  it('rounds gallons to the tenth', () => {
    expect(roundGallons(212.349)).toBe(212.3);
    expect(roundGallons(212.35)).toBe(212.4);
  });

  it('rounds a gauge to the whole percent', () => {
    expect(roundPercent(28.4)).toBe(28);
    expect(roundPercent(28.5)).toBe(29);
  });

  it('refuses to round something that is not a number', () => {
    expect(() => roundGallons(Number.NaN)).toThrowError(/gallons/);
    expect(() => roundPercent(Number.NaN)).toThrowError(/percent/);
  });
});
