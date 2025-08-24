import { describe, expect, it } from 'vitest';
import {
  MINIMUM_ECONOMIC_DROP,
  assertFits,
  gaugeAfterDrop,
  marginShare,
  planDrop,
  totalPlanned,
} from '../../../src/core/drop-sizing';
import { OverfillError } from '../../../src/core/errors';
import { percent } from '../../../src/core/units';
import { tankGeometry } from '../../../src/core/tank-math';

const five = tankGeometry(500);

describe('marginShare', () => {
  it('keeps a little back even on a perfect fit', () => {
    expect(marginShare(1)).toBeCloseTo(0.02, 9);
  });

  it('grows as the fit gets worse', () => {
    expect(marginShare(0)).toBeCloseTo(0.15, 9);
    expect(marginShare(0.5)).toBeGreaterThan(marginShare(0.9));
  });

  it('refuses a confidence that is not a share', () => {
    expect(() => marginShare(1.5)).toThrowError(/confidence/);
    expect(() => marginShare(-0.1)).toThrowError(/confidence/);
  });
});

describe('planDrop', () => {
  it('plans most of the room but not all of it', () => {
    const drop = planDrop(five, percent(20), { confidence: 1 });
    expect(drop.roomGallons).toBe(300);
    expect(drop.gallons).toBe(290);
    expect(drop.marginGallons).toBeCloseTo(10, 9);
  });

  it('keeps more back when the model is shaky', () => {
    const good = planDrop(five, percent(20), { confidence: 0.95 });
    const poor = planDrop(five, percent(20), { confidence: 0.2 });
    expect(poor.gallons).toBeLessThan(good.gallons);
  });

  it('rounds down to the step', () => {
    expect(planDrop(five, percent(20), { confidence: 1, roundTo: 25 }).gallons).toBe(275);
  });

  it('can be told not to round at all', () => {
    expect(planDrop(five, percent(20), { confidence: 1, roundTo: 0 }).gallons).toBeCloseTo(294, 9);
  });

  it('respects a cap, such as what is left on the truck', () => {
    expect(planDrop(five, percent(20), { confidence: 1, maximumDrop: 150 }).gallons).toBe(150);
  });

  it('plans nothing for a tank that is already at the filling limit', () => {
    const drop = planDrop(five, percent(80));
    expect(drop.gallons).toBe(0);
    expect(drop.worthMaking).toBe(false);
  });

  it('calls a small drop not worth making', () => {
    const drop = planDrop(tankGeometry(120), percent(65), { confidence: 1 });
    expect(drop.gallons).toBeLessThan(MINIMUM_ECONOMIC_DROP);
    expect(drop.worthMaking).toBe(false);
  });

  it('takes a different minimum for a customer who pays for small drops', () => {
    const drop = planDrop(tankGeometry(120), percent(65), { confidence: 1, minimumDrop: 10 });
    expect(drop.worthMaking).toBe(true);
  });

  it('refuses a negative rounding step or minimum', () => {
    expect(() => planDrop(five, percent(20), { roundTo: -1 })).toThrowError(/rounding step/);
    expect(() => planDrop(five, percent(20), { minimumDrop: -1 })).toThrowError(/minimum drop/);
    expect(() => planDrop(five, percent(20), { maximumDrop: -1 })).toThrowError(/maximum drop/);
  });

  it('follows the tank filling limit', () => {
    const underground = tankGeometry(500, { fillLimit: 85 });
    expect(planDrop(underground, percent(20), { confidence: 1 }).roomGallons).toBe(325);
  });
});

describe('assertFits', () => {
  it('allows a drop that fits', () => {
    expect(() => assertFits('t-1', five, percent(20), 300)).not.toThrow();
  });

  it('allows a drop that exactly fills to the limit', () => {
    expect(() => assertFits('t-1', five, percent(30), 250)).not.toThrow();
  });

  it('refuses one that would pass the limit', () => {
    expect(() => assertFits('t-1', five, percent(30), 260)).toThrowError(OverfillError);
    expect(() => assertFits('t-1', five, percent(30), 260)).toThrowError(/room is 250/);
  });

  it('names the tank in the failure', () => {
    try {
      assertFits('t-77', five, percent(70), 100);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as OverfillError).detail.tankId).toBe('t-77');
    }
  });
});

describe('gaugeAfterDrop', () => {
  it('adds the drop to the gauge', () => {
    expect(gaugeAfterDrop(five, percent(20), 300)).toBe(80);
  });

  it('clamps at a full shell', () => {
    expect(gaugeAfterDrop(five, percent(90), 300)).toBe(100);
  });

  it('refuses a negative drop', () => {
    expect(() => gaugeAfterDrop(five, percent(20), -1)).toThrowError(/gallons/);
  });
});

describe('totalPlanned', () => {
  it('adds up a route', () => {
    const drops = [
      planDrop(five, percent(20), { confidence: 1 }),
      planDrop(five, percent(40), { confidence: 1 }),
    ];
    expect(totalPlanned(drops)).toBe(drops[0]!.gallons + drops[1]!.gallons);
  });

  it('is zero for no stops', () => {
    expect(totalPlanned([])).toBe(0);
  });
});
