import { describe, expect, it } from 'vitest';
import {
  REFERENCE_TEMPERATURE,
  correctionFactor,
  correctionSpread,
  supportedBuckets,
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

  it('snaps to the nearest bucket', () => {
    expect(correctionFactor(fahrenheit(88))).toBe(correctionFactor(fahrenheit(90)));
    expect(correctionFactor(fahrenheit(84))).toBe(correctionFactor(fahrenheit(80)));
  });

  it('clamps to the ends of the table', () => {
    expect(correctionFactor(fahrenheit(-70))).toBe(correctionFactor(fahrenheit(-30)));
    expect(correctionFactor(fahrenheit(140))).toBe(correctionFactor(fahrenheit(110)));
  });
});

describe('toNetGallons', () => {
  it('bills less than the meter showed on a hot day', () => {
    const net = toNetGallons(grossGallons(300), fahrenheit(90));
    expect(net).toBeCloseTo(275.4, 4);
  });

  it('bills more than the meter showed on a cold day', () => {
    const net = toNetGallons(grossGallons(300), fahrenheit(10));
    expect(net).toBeCloseTo(315.3, 4);
  });

  it('leaves a zero drop at zero', () => {
    expect(toNetGallons(grossGallons(0), fahrenheit(90))).toBe(0);
  });
});

describe('toGrossGallons', () => {
  it('inverts the correction', () => {
    const gross = grossGallons(412.7);
    const temp = fahrenheit(78);
    const net = toNetGallons(gross, temp);
    expect(toGrossGallons(net, temp)).toBeCloseTo(gross, 6);
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

describe('supportedBuckets', () => {
  it('runs from thirty below to a hundred and ten in ten degree steps', () => {
    const buckets = supportedBuckets();
    expect(buckets[0]).toBe(-30);
    expect(buckets[buckets.length - 1]).toBe(110);
    for (let i = 1; i < buckets.length; i += 1) {
      expect((buckets[i] as number) - (buckets[i - 1] as number)).toBe(10);
    }
  });

  it('covers the sixty degree reference exactly', () => {
    expect(supportedBuckets()).toContain(60);
  });
});

describe('net gallon construction', () => {
  it('refuses a negative net figure built by hand', () => {
    expect(() => netGallons(-1)).toThrowError(/net gallons/);
  });
});
