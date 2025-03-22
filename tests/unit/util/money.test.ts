import { describe, expect, it } from 'vitest';
import {
  addCents,
  allocate,
  cents,
  extend,
  formatCents,
  formatMills,
  mills,
  parseCents,
  parseMills,
  percentOf,
  roundHalfUp,
  subtractCents,
} from '../../../src/util/money';

describe('constructors', () => {
  it('refuse a fractional amount', () => {
    expect(() => cents(10.5)).toThrowError(/whole number/);
    expect(() => mills(10.5)).toThrowError(/whole number/);
  });
});

describe('parseCents', () => {
  it('reads the usual shapes', () => {
    expect(parseCents('12.34')).toBe(1234);
    expect(parseCents('$12.34')).toBe(1234);
    expect(parseCents('1,204.00')).toBe(120400);
    expect(parseCents('7')).toBe(700);
    expect(parseCents('7.5')).toBe(750);
  });

  it('reads a credit', () => {
    expect(parseCents('-42.10')).toBe(-4210);
  });

  it('refuses more precision than a cent', () => {
    expect(() => parseCents('12.345')).toThrowError(/more precision than a cent/);
  });

  it('refuses something that is not money', () => {
    expect(() => parseCents('twelve')).toThrowError(/not an amount of money/);
    expect(() => parseCents('  ')).toThrowError(/must not be blank/);
  });
});

describe('parseMills', () => {
  it('keeps the tenth of a cent', () => {
    expect(parseMills('2.4990')).toBe(24990);
    expect(parseMills('$2.499')).toBe(24990);
    expect(parseMills('2')).toBe(20000);
  });

  it('refuses a price quoted finer than that', () => {
    expect(() => parseMills('2.49901')).toThrowError(/finer than a tenth of a cent/);
  });

  it('refuses a negative price', () => {
    expect(() => parseMills('-2.10')).toThrowError(/not a price/);
  });
});

describe('formatting', () => {
  it('prints cents with a thousands separator', () => {
    expect(formatCents(cents(120400))).toBe('$1,204.00');
    expect(formatCents(cents(5))).toBe('$0.05');
  });

  it('prints a credit with the sign in front of the dollar', () => {
    expect(formatCents(cents(-4210))).toBe('-$42.10');
  });

  it('prints a price to four places', () => {
    expect(formatMills(mills(24990))).toBe('$2.4990');
    expect(formatMills(mills(20000))).toBe('$2.0000');
  });
});

describe('roundHalfUp', () => {
  it('rounds a half away from zero on both sides', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
  });
});

describe('extend', () => {
  it('multiplies gallons by a posted price', () => {
    expect(extend(212.4, parseMills('2.4990'))).toBe(53079);
    expect(formatCents(extend(212.4, parseMills('2.4990')))).toBe('$530.79');
  });

  it('handles a zero drop', () => {
    expect(extend(0, parseMills('2.4990'))).toBe(0);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts', () => {
    expect(addCents(cents(100), cents(250), cents(-50))).toBe(300);
    expect(subtractCents(cents(1000), cents(250))).toBe(750);
  });

  it('adds nothing to zero', () => {
    expect(addCents()).toBe(0);
  });

  it('takes a percentage', () => {
    expect(percentOf(cents(53078), 6.5)).toBe(3450);
  });
});

describe('allocate', () => {
  it('splits evenly when it can', () => {
    expect(allocate(cents(1000), 4)).toEqual([250, 250, 250, 250]);
  });

  it('spreads the remainder over the earliest shares', () => {
    expect(allocate(cents(1001), 4)).toEqual([251, 250, 250, 250]);
    expect(allocate(cents(1003), 4)).toEqual([251, 251, 251, 250]);
  });

  it('always sums back to the original', () => {
    for (const amount of [1, 99, 100, 12345, 999999]) {
      for (const shares of [2, 3, 7, 11, 12]) {
        const parts = allocate(cents(amount), shares);
        expect(parts).toHaveLength(shares);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(amount);
      }
    }
  });

  it('handles a credit', () => {
    const parts = allocate(cents(-1001), 4);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-1001);
  });

  it('refuses a share count that is not a positive whole number', () => {
    expect(() => allocate(cents(100), 0)).toThrowError(/shares/);
    expect(() => allocate(cents(100), 2.5)).toThrowError(/shares/);
  });
});
