import { describe, expect, it } from 'vitest';
import { round, roundGallons, roundPercent, roundRate } from '../../../src/util/round';

describe('round', () => {
  it('rounds to a tenth by default', () => {
    expect(round(4.333)).toBe(4.3);
    expect(round(4.35)).toBe(4.4);
  });

  it('takes a different number of places', () => {
    expect(round(4.3333, 2)).toBe(4.33);
    expect(round(4.3333, 0)).toBe(4);
  });

  it('takes a half away from zero on both sides', () => {
    expect(round(0.5, 0)).toBe(1);
    expect(round(-0.5, 0)).toBe(-1);
    expect(round(-1.5, 0)).toBe(-2);
  });

  it('leaves a whole number alone', () => {
    expect(round(4, 2)).toBe(4);
    expect(round(0)).toBe(0);
  });

  it('refuses a value that is not a number', () => {
    expect(() => round(Number.NaN)).toThrowError(/value/);
    expect(() => round(Number.POSITIVE_INFINITY)).toThrowError(/value/);
  });

  it('refuses a place count that is not a whole number', () => {
    expect(() => round(1, 1.5)).toThrowError(/places/);
    expect(() => round(1, -1)).toThrowError(/cannot round to -1 places/);
  });
});

describe('the named roundings', () => {
  it('gallons go to the tenth', () => {
    expect(roundGallons(212.349)).toBe(212.3);
  });

  it('a rate goes to four places', () => {
    expect(roundRate(0.123456)).toBe(0.1235);
  });

  it('a share becomes a whole percent', () => {
    expect(roundPercent(0.9333)).toBe(93);
    expect(roundPercent(1)).toBe(100);
  });
});
