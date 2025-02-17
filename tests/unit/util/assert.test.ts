import { describe, expect, it } from 'vitest';
import {
  AssertionError,
  assert,
  assertFinite,
  assertInRange,
  assertInteger,
  assertNonEmpty,
  assertNonNegative,
  assertPositive,
  required,
  unreachable,
} from '../../../src/util/assert';

describe('assert', () => {
  it('passes a truthy condition through', () => {
    expect(() => assert(1 === 1, 'nope')).not.toThrow();
  });

  it('throws an AssertionError carrying the message', () => {
    expect(() => assert(false, 'tank is missing')).toThrowError(AssertionError);
    expect(() => assert(false, 'tank is missing')).toThrowError(/tank is missing/);
  });
});

describe('assertFinite', () => {
  it('returns the value', () => {
    expect(assertFinite(12.5, 'gallons')).toBe(12.5);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects %s',
    (value) => {
      expect(() => assertFinite(value, 'gallons')).toThrowError(/gallons/);
    },
  );
});

describe('assertNonNegative', () => {
  it('accepts zero', () => {
    expect(assertNonNegative(0, 'gallons')).toBe(0);
  });

  it('rejects a negative', () => {
    expect(() => assertNonNegative(-0.5, 'gallons')).toThrowError(/must not be negative/);
  });
});

describe('assertPositive', () => {
  it('rejects zero', () => {
    expect(() => assertPositive(0, 'capacity')).toThrowError(/greater than zero/);
  });

  it('accepts a small positive', () => {
    expect(assertPositive(0.001, 'capacity')).toBe(0.001);
  });
});

describe('assertInRange', () => {
  it('accepts the boundaries', () => {
    expect(assertInRange(0, 0, 100, 'percent')).toBe(0);
    expect(assertInRange(100, 0, 100, 'percent')).toBe(100);
  });

  it('rejects outside', () => {
    expect(() => assertInRange(140, 0, 100, 'percent')).toThrowError(/between 0 and 100/);
  });
});

describe('assertInteger', () => {
  it('rejects a fraction', () => {
    expect(() => assertInteger(2.5, 'stop count')).toThrowError(/whole number/);
  });
});

describe('assertNonEmpty', () => {
  it('rejects whitespace only', () => {
    expect(() => assertNonEmpty('   ', 'account number')).toThrowError(/must not be blank/);
  });

  it('returns the original string, untrimmed', () => {
    expect(assertNonEmpty(' A-1 ', 'account number')).toBe(' A-1 ');
  });
});

describe('required', () => {
  it('passes a value through', () => {
    expect(required(0, 'reading')).toBe(0);
  });

  it('rejects null and undefined', () => {
    expect(() => required(null, 'reading')).toThrowError(/reading is required/);
    expect(() => required(undefined, 'reading')).toThrowError(/reading is required/);
  });
});

describe('unreachable', () => {
  it('always throws', () => {
    expect(() => unreachable('surprise' as never, 'mode')).toThrowError(/unexpected mode/);
  });
});
