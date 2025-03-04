import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILL_LIMIT,
  OUT_OF_GAS_PERCENT,
  STOCK_CAPACITIES,
  capacityToFillLimit,
  gallonsAboveReserve,
  gallonsAt,
  gaugeFor,
  isBelowReserve,
  isOutOfGas,
  isOverfilled,
  isStockCapacity,
  roomToFill,
  tankGeometry,
  ullage,
  usableSpan,
} from '../../../src/core/tank-math';
import { netGallons, percent } from '../../../src/core/units';

const fiveHundred = tankGeometry(500);

describe('tankGeometry', () => {
  it('defaults to the eighty percent filling limit and a quarter tank reserve', () => {
    expect(fiveHundred.fillLimit).toBe(DEFAULT_FILL_LIMIT);
    expect(fiveHundred.reservePercent).toBe(25);
  });

  it('takes overrides', () => {
    const g = tankGeometry(1000, { fillLimit: 82, reservePercent: 30 });
    expect(g.fillLimit).toBe(82);
    expect(g.reservePercent).toBe(30);
  });

  it('refuses a reserve above the filling limit', () => {
    expect(() => tankGeometry(500, { reservePercent: 85 })).toThrowError(/reserve percent/);
  });

  it('refuses a filling limit nobody would set', () => {
    expect(() => tankGeometry(500, { fillLimit: 95 })).toThrowError(/fill limit/);
  });

  it('refuses a tank with no capacity', () => {
    expect(() => tankGeometry(0)).toThrowError(/water capacity/);
  });
});

describe('gallonsAt and gaugeFor', () => {
  it('reads the gauge as a percent of water capacity', () => {
    expect(gallonsAt(fiveHundred, percent(80))).toBe(400);
    expect(gallonsAt(fiveHundred, percent(40))).toBe(200);
  });

  it('round trips', () => {
    expect(gaugeFor(fiveHundred, gallonsAt(fiveHundred, percent(37)))).toBeCloseTo(37, 9);
  });

  it('clamps a gauge computed from an impossible volume', () => {
    expect(gaugeFor(fiveHundred, netGallons(900))).toBe(100);
  });
});

describe('capacityToFillLimit', () => {
  it('is eighty percent of water capacity by default', () => {
    expect(capacityToFillLimit(fiveHundred)).toBe(400);
    expect(capacityToFillLimit(tankGeometry(1000))).toBe(800);
  });
});

describe('roomToFill', () => {
  it('is what is left below the filling limit', () => {
    expect(roomToFill(fiveHundred, percent(30))).toBe(250);
  });

  it('is zero at the filling limit', () => {
    expect(roomToFill(fiveHundred, percent(80))).toBe(0);
  });

  it('does not go negative on an overfilled tank', () => {
    expect(roomToFill(fiveHundred, percent(88))).toBe(0);
  });
});

describe('gallonsAboveReserve', () => {
  it('measures down to the reserve mark, not to empty', () => {
    expect(gallonsAboveReserve(fiveHundred, percent(45))).toBe(100);
  });

  it('is zero once the gauge is under the mark', () => {
    expect(gallonsAboveReserve(fiveHundred, percent(20))).toBe(0);
  });
});

describe('usableSpan', () => {
  it('is the reserve mark up to the filling limit', () => {
    expect(usableSpan(fiveHundred)).toBe(275);
    expect(usableSpan(tankGeometry(250, { reservePercent: 20 }))).toBe(150);
  });
});

describe('ullage', () => {
  it('is the vapour space, measured against the whole shell', () => {
    expect(ullage(fiveHundred, percent(80))).toBe(100);
    expect(ullage(fiveHundred, percent(0))).toBe(500);
  });
});

describe('condition flags', () => {
  it('spots an overfill', () => {
    expect(isOverfilled(fiveHundred, percent(82))).toBe(true);
    expect(isOverfilled(fiveHundred, percent(80))).toBe(false);
  });

  it('spots a tank under its reserve mark', () => {
    expect(isBelowReserve(fiveHundred, percent(24))).toBe(true);
    expect(isBelowReserve(fiveHundred, percent(25))).toBe(false);
  });

  it('spots a tank that has effectively lost pressure', () => {
    expect(isOutOfGas(percent(OUT_OF_GAS_PERCENT))).toBe(true);
    expect(isOutOfGas(percent(6))).toBe(false);
  });
});

describe('isStockCapacity', () => {
  it('knows the sizes on the yard', () => {
    for (const size of STOCK_CAPACITIES) {
      expect(isStockCapacity(size)).toBe(true);
    }
    expect(isStockCapacity(400)).toBe(false);
  });
});
