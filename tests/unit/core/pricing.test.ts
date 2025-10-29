import { describe, expect, it } from 'vitest';
import {
  PriceSchedule,
  drawLock,
  makeSchedule,
  postedPrice,
  quote,
  scheduleFor,
  tierFor,
} from '../../../src/core/pricing';
import { cents, formatCents, parseMills } from '../../../src/util/money';
import { dayKey } from '../../../src/util/dates';

const residential: PriceSchedule = makeSchedule({
  id: 'ps-1',
  rateClass: 'residential',
  effectiveFrom: dayKey('2025-09-01'),
  tiers: [
    { fromGallons: 0, pricePerGallon: parseMills('3.4990') },
    { fromGallons: 150, pricePerGallon: parseMills('3.2490') },
    { fromGallons: 300, pricePerGallon: parseMills('2.9990') },
    { fromGallons: 500, pricePerGallon: parseMills('2.7490') },
  ],
});

describe('makeSchedule', () => {
  it('sorts the tiers', () => {
    const built = makeSchedule({
      ...residential,
      tiers: [
        { fromGallons: 300, pricePerGallon: parseMills('2.99') },
        { fromGallons: 0, pricePerGallon: parseMills('3.49') },
      ],
    });
    expect(built.tiers.map((tier) => tier.fromGallons)).toEqual([0, 300]);
  });

  it('refuses a schedule with no tiers', () => {
    expect(() => makeSchedule({ ...residential, tiers: [] })).toThrowError(/at least one tier/);
  });

  it('refuses one that does not start at zero', () => {
    expect(() =>
      makeSchedule({
        ...residential,
        tiers: [{ fromGallons: 50, pricePerGallon: parseMills('3') }],
      }),
    ).toThrowError(/start at zero gallons/);
  });

  it('refuses two tiers at the same break', () => {
    expect(() =>
      makeSchedule({
        ...residential,
        tiers: [
          { fromGallons: 0, pricePerGallon: parseMills('3') },
          { fromGallons: 150, pricePerGallon: parseMills('2.9') },
          { fromGallons: 150, pricePerGallon: parseMills('2.8') },
        ],
      }),
    ).toThrowError(/both start at 150/);
  });
});

describe('tierFor', () => {
  it('picks the tier the whole fill falls into', () => {
    expect(tierFor(residential, 100).fromGallons).toBe(0);
    expect(tierFor(residential, 150).fromGallons).toBe(150);
    expect(tierFor(residential, 499).fromGallons).toBe(300);
    expect(tierFor(residential, 900).fromGallons).toBe(500);
  });

  it('refuses a negative fill', () => {
    expect(() => tierFor(residential, -1)).toThrowError(/gallons/);
  });
});

describe('postedPrice', () => {
  it('is the tier price', () => {
    expect(postedPrice(residential, 400)).toBe(parseMills('2.9990'));
  });

  it('adds a surcharge when the schedule carries one', () => {
    const withAdder = { ...residential, adderPerGallon: parseMills('0.0500') };
    expect(postedPrice(withAdder, 400)).toBe(parseMills('3.0490'));
  });
});

describe('quote', () => {
  it('prices a plain fill', () => {
    const result = quote(residential, 400);
    expect(result.charges).toHaveLength(1);
    expect(formatCents(result.subtotal)).toBe('$1,199.60');
    expect(result.total).toBe(result.subtotal);
  });

  it('adds tax on the product', () => {
    const result = quote(residential, 400, { taxPercent: 8 });
    expect(result.tax).toBe(9597);
    expect(result.total).toBe(result.subtotal + result.tax);
  });

  it('adds flat fees', () => {
    const result = quote(residential, 400, {
      flatFees: [
        { label: 'hazmat', amount: cents(495) },
        { label: 'fuel', amount: cents(250) },
      ],
    });
    expect(result.fees).toBe(745);
    expect(result.total).toBe(result.subtotal + 745);
  });

  it('reports the blended price', () => {
    expect(quote(residential, 400).effectivePricePerGallon).toBe(parseMills('2.9990'));
  });

  it('handles a fill of nothing', () => {
    const result = quote(residential, 0);
    expect(result.total).toBe(0);
    expect(result.effectivePricePerGallon).toBe(0);
  });

  it('refuses a negative fill', () => {
    expect(() => quote(residential, -5)).toThrowError(/gallons/);
  });
});

describe('quotes against a lock', () => {
  const lock = {
    pricePerGallon: parseMills('2.4990'),
    gallonsRemaining: 200,
    expiresOn: dayKey('2026-06-30'),
  };

  it('uses the locked price up to the cap', () => {
    const result = quote(residential, 500, { lock });
    expect(result.charges[0]).toMatchObject({ label: 'locked price', gallons: 200 });
    expect(result.charges[1]).toMatchObject({ label: 'posted price', gallons: 300 });
  });

  it('prices the remainder off the tier for the whole fill', () => {
    const result = quote(residential, 500, { lock });
    expect(result.charges[1]?.pricePerGallon).toBe(parseMills('2.7490'));
  });

  it('covers the whole fill when the lock is big enough', () => {
    const result = quote(residential, 150, { lock });
    expect(result.charges).toHaveLength(1);
    expect(result.charges[0]?.label).toBe('locked price');
  });

  it('ignores an exhausted lock', () => {
    const result = quote(residential, 400, { lock: { ...lock, gallonsRemaining: 0 } });
    expect(result.charges[0]?.label).toBe('posted price');
  });

  it('ignores an expired lock', () => {
    const result = quote(residential, 400, { lock, on: dayKey('2026-07-01') });
    expect(result.charges[0]?.label).toBe('posted price');
  });

  it('honours a lock on its last day', () => {
    const result = quote(residential, 100, { lock, on: dayKey('2026-06-30') });
    expect(result.charges[0]?.label).toBe('locked price');
  });

  it('blends the two prices into one effective figure', () => {
    const result = quote(residential, 500, { lock });
    expect(result.effectivePricePerGallon).toBeGreaterThan(lock.pricePerGallon);
    expect(result.effectivePricePerGallon).toBeLessThan(parseMills('2.7490'));
  });
});

describe('scheduleFor', () => {
  const older = { ...residential, id: 'ps-0', effectiveFrom: dayKey('2025-01-01') };
  const commercial = { ...residential, id: 'ps-2', rateClass: 'commercial' as const };

  it('takes the most recent schedule in force', () => {
    expect(scheduleFor([older, residential], 'residential', dayKey('2025-10-01'))?.id).toBe('ps-1');
  });

  it('ignores one that has not started yet', () => {
    expect(scheduleFor([older, residential], 'residential', dayKey('2025-06-01'))?.id).toBe('ps-0');
  });

  it('keeps the rate classes apart', () => {
    expect(scheduleFor([residential, commercial], 'commercial', dayKey('2025-10-01'))?.id).toBe(
      'ps-2',
    );
  });

  it('has nothing for a class with no schedule', () => {
    expect(scheduleFor([residential], 'agricultural', dayKey('2025-10-01'))).toBeUndefined();
  });
});

describe('drawLock', () => {
  const lock = {
    pricePerGallon: parseMills('2.4990'),
    gallonsRemaining: 200,
    expiresOn: dayKey('2026-06-30'),
  };

  it('takes the gallons off', () => {
    expect(drawLock(lock, 50).gallonsRemaining).toBe(150);
  });

  it('never goes below zero', () => {
    expect(drawLock(lock, 900).gallonsRemaining).toBe(0);
  });

  it('refuses a negative draw', () => {
    expect(() => drawLock(lock, -1)).toThrowError(/gallons/);
  });
});
