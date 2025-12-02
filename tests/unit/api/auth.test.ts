import { describe, expect, it } from 'vitest';
import { KeyRing, allows, hashKey, makeKeyRecord } from '../../../src/api/auth';

const OFFICE_KEY = 'office-key-that-is-long-enough';
const DRIVER_KEY = 'driver-key-that-is-long-enough';

function ring(): KeyRing {
  return new KeyRing([
    makeKeyRecord('office screens', 'office', OFFICE_KEY),
    makeKeyRecord('handhelds', 'driver', DRIVER_KEY),
  ]);
}

describe('hashKey', () => {
  it('is stable and hex', () => {
    expect(hashKey('abc')).toBe(hashKey('abc'));
    expect(hashKey('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes completely for a different key', () => {
    expect(hashKey('abc')).not.toBe(hashKey('abd'));
  });
});

describe('makeKeyRecord', () => {
  it('never keeps the key itself', () => {
    const record = makeKeyRecord('office', 'office', OFFICE_KEY);
    expect(JSON.stringify(record)).not.toContain(OFFICE_KEY);
    expect(record.keyHash).toBe(hashKey(OFFICE_KEY));
  });

  it('refuses a role it does not know', () => {
    expect(() => makeKeyRecord('x', 'boss' as never, OFFICE_KEY)).toThrowError(/not a role/);
  });

  it('refuses a key short enough to guess', () => {
    expect(() => makeKeyRecord('x', 'office', 'short')).toThrowError(/twenty four characters/);
  });
});

describe('KeyRing', () => {
  it('resolves a key to its caller', () => {
    expect(ring().resolve(OFFICE_KEY)).toEqual({ name: 'office screens', role: 'office' });
  });

  it('tells the two keys apart', () => {
    expect(ring().resolve(DRIVER_KEY)?.role).toBe('driver');
  });

  it('rejects a key it does not hold', () => {
    expect(ring().resolve('some-other-key-long-enough')).toBeUndefined();
  });

  it('rejects an absent key', () => {
    expect(ring().resolve(undefined)).toBeUndefined();
    expect(ring().resolve('')).toBeUndefined();
  });

  it('reports how many keys it holds', () => {
    expect(ring().size).toBe(2);
    expect(new KeyRing([]).size).toBe(0);
  });
});

describe('allows', () => {
  it('lets a role through when it is listed', () => {
    expect(allows({ name: 'x', role: 'office' }, ['office', 'job'])).toBe(true);
    expect(allows({ name: 'x', role: 'driver' }, ['office'])).toBe(false);
  });

  it('lets admin through whatever the list says', () => {
    expect(allows({ name: 'x', role: 'admin' }, ['office'])).toBe(true);
    expect(allows({ name: 'x', role: 'admin' }, [])).toBe(true);
  });
});
