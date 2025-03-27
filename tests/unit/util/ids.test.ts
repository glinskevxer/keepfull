import { describe, expect, it } from 'vitest';
import {
  IdFactory,
  accountNumber,
  dammDigit,
  encodeBase32,
  isValidTicketNumber,
  parseAccountNumber,
  systemClock,
  ticketNumber,
} from '../../../src/util/ids';

describe('encodeBase32', () => {
  it('pads to the requested width', () => {
    expect(encodeBase32(0, 4)).toBe('0000');
    expect(encodeBase32(31, 4)).toBe('000Z');
    expect(encodeBase32(32, 4)).toBe('0010');
  });

  it('keeps only the low characters when it overflows the width', () => {
    expect(encodeBase32(32 * 32 * 32, 2)).toBe('00');
  });

  it('refuses a fractional value', () => {
    expect(() => encodeBase32(1.5, 4)).toThrowError(/whole number/);
  });
});

describe('IdFactory', () => {
  it('sorts in the order the ids were made', () => {
    let time = 1_700_000_000_000;
    const factory = new IdFactory({ now: () => (time += 1000) }, () => 0.5);
    const first = factory.next();
    const second = factory.next();
    expect(second > first).toBe(true);
  });

  it('does not repeat inside a single millisecond', () => {
    const factory = new IdFactory({ now: () => 1_700_000_000_000 }, () => 0);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      seen.add(factory.next());
    }
    expect(seen.size).toBe(50);
  });

  it('puts the prefix in front with an underscore', () => {
    const factory = new IdFactory({ now: () => 1_700_000_000_000 }, () => 0);
    expect(factory.next('tkt')).toMatch(/^tkt_[0-9A-Z]{12}$/);
  });

  it('has a real clock by default', () => {
    expect(systemClock.now()).toBeGreaterThan(1_600_000_000_000);
    expect(new IdFactory().next()).toHaveLength(12);
  });
});

describe('accountNumber', () => {
  it('pads both halves', () => {
    expect(accountNumber(4, 118372)).toBe('04-118372');
    expect(accountNumber(12, 7)).toBe('12-000007');
  });

  it('refuses a branch that will not fit', () => {
    expect(() => accountNumber(100, 1)).toThrowError(/two digit branch/);
  });

  it('refuses a serial that will not fit', () => {
    expect(() => accountNumber(1, 1_000_000)).toThrowError(/six digits/);
  });

  it('round trips', () => {
    expect(parseAccountNumber(accountNumber(4, 118372))).toEqual({ branch: 4, serial: 118372 });
  });

  it('refuses something shaped wrong', () => {
    expect(() => parseAccountNumber('4-118372')).toThrowError(/not an account number/);
    expect(() => parseAccountNumber('')).toThrowError(/must not be blank/);
  });
});

describe('dammDigit', () => {
  it('is zero for a string that already checks out', () => {
    const digits = '0000881';
    expect(dammDigit(digits + String(dammDigit(digits)))).toBe(0);
  });

  it('refuses letters', () => {
    expect(() => dammDigit('12a4')).toThrowError(/non digit/);
  });
});

describe('ticketNumber', () => {
  it('is eight characters', () => {
    expect(ticketNumber(881)).toHaveLength(8);
    expect(ticketNumber(881)).toMatch(/^0000881\d$/);
  });

  it('validates itself', () => {
    for (const serial of [1, 881, 12345, 9_999_999]) {
      expect(isValidTicketNumber(ticketNumber(serial))).toBe(true);
    }
  });

  it('catches a single wrong digit', () => {
    const good = ticketNumber(123456);
    for (let position = 0; position < 7; position += 1) {
      for (let digit = 0; digit <= 9; digit += 1) {
        const character = String(digit);
        if (character === good[position]) {
          continue;
        }
        const bad = good.slice(0, position) + character + good.slice(position + 1);
        expect(isValidTicketNumber(bad)).toBe(false);
      }
    }
  });

  it('catches two adjacent digits swapped', () => {
    const good = ticketNumber(1234567);
    for (let position = 0; position < 7; position += 1) {
      const a = good[position] as string;
      const b = good[position + 1] as string;
      if (a === b) {
        continue;
      }
      const bad = good.slice(0, position) + b + a + good.slice(position + 2);
      expect(isValidTicketNumber(bad)).toBe(false);
    }
  });

  it('rejects anything that is not eight digits', () => {
    expect(isValidTicketNumber('881')).toBe(false);
    expect(isValidTicketNumber('0000881X')).toBe(false);
  });

  it('refuses a serial of zero', () => {
    expect(() => ticketNumber(0)).toThrowError(/ticket serial/);
  });
});
