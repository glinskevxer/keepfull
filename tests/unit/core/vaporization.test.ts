import { describe, expect, it } from 'vitest';
import {
  WALL_COEFFICIENT,
  checkLoad,
  depthForVolumeFraction,
  knownCapacities,
  shellFor,
  smallestTankFor,
  vaporizationCapacity,
  volumeFractionForDepth,
  wettedAreaSquareFeet,
} from '../../../src/core/vaporization';
import { fahrenheit, percent } from '../../../src/core/units';

describe('shellFor', () => {
  it('knows the standard sizes', () => {
    expect(knownCapacities()).toEqual([120, 250, 320, 500, 1000]);
    expect(shellFor(500).diameterFeet).toBe(3);
  });

  it('refuses a size it has no drawing for', () => {
    expect(() => shellFor(400)).toThrowError(/no shell drawing for a 400 gallon tank/);
  });
});

describe('the depth and volume relationship', () => {
  it('is symmetric about half full', () => {
    expect(volumeFractionForDepth(0.5)).toBeCloseTo(0.5, 9);
    expect(depthForVolumeFraction(0.5)).toBeCloseTo(0.5, 6);
  });

  it('hits both ends exactly', () => {
    expect(volumeFractionForDepth(0)).toBe(0);
    expect(volumeFractionForDepth(1)).toBeCloseTo(1, 9);
    expect(depthForVolumeFraction(0)).toBe(0);
    expect(depthForVolumeFraction(1)).toBe(1);
  });

  it('round trips', () => {
    for (const fraction of [0.1, 0.25, 0.4, 0.6, 0.8, 0.95]) {
      expect(volumeFractionForDepth(depthForVolumeFraction(fraction))).toBeCloseTo(fraction, 6);
    }
  });

  it('shows that a horizontal tank is deeper than its gauge suggests near empty', () => {
    // Twenty percent of the volume sits above a quarter of the diameter.
    expect(depthForVolumeFraction(0.2)).toBeGreaterThan(0.2);
  });

  it('refuses a fraction outside the tank', () => {
    expect(() => depthForVolumeFraction(1.5)).toThrowError(/volume fraction/);
    expect(() => volumeFractionForDepth(-0.1)).toThrowError(/depth fraction/);
  });
});

describe('wettedAreaSquareFeet', () => {
  it('is nothing when the tank is empty', () => {
    expect(wettedAreaSquareFeet(500, percent(0))).toBe(0);
  });

  it('grows with the level', () => {
    const low = wettedAreaSquareFeet(500, percent(20));
    const high = wettedAreaSquareFeet(500, percent(70));
    expect(high).toBeGreaterThan(low);
  });

  it('is bigger on a bigger tank at the same gauge', () => {
    expect(wettedAreaSquareFeet(1000, percent(50))).toBeGreaterThan(
      wettedAreaSquareFeet(500, percent(50)),
    );
  });

  it('lands in the right ballpark for a half full five hundred', () => {
    // Half the barrel of a three foot by ten foot tank is about forty seven
    // square feet, plus a little from the ends.
    expect(wettedAreaSquareFeet(500, percent(50))).toBeGreaterThan(40);
    expect(wettedAreaSquareFeet(500, percent(50))).toBeLessThan(60);
  });
});

describe('vaporizationCapacity', () => {
  it('is proportional to the temperature difference', () => {
    const warm = vaporizationCapacity(500, percent(50), fahrenheit(40));
    const cold = vaporizationCapacity(500, percent(50), fahrenheit(10));
    expect(warm / cold).toBeCloseTo(70 / 40, 6);
  });

  it('is nothing once the air is at the working boiling point', () => {
    expect(vaporizationCapacity(500, percent(50), fahrenheit(-30))).toBe(0);
    expect(vaporizationCapacity(500, percent(50), fahrenheit(-40))).toBe(0);
  });

  it('follows the wall coefficient', () => {
    const base = vaporizationCapacity(500, percent(50), fahrenheit(20));
    expect(
      vaporizationCapacity(500, percent(50), fahrenheit(20), WALL_COEFFICIENT * 2),
    ).toBeCloseTo(base * 2, 6);
  });

  it('refuses a coefficient of zero', () => {
    expect(() => vaporizationCapacity(500, percent(50), fahrenheit(20), 0)).toThrowError(
      /wall coefficient/,
    );
  });
});

describe('published ballpark', () => {
  it('matches the vaporization tables for a half full five hundred at twenty degrees', () => {
    const capacity = vaporizationCapacity(500, percent(50), fahrenheit(20));
    expect(capacity).toBeGreaterThan(400_000);
    expect(capacity).toBeLessThan(600_000);
  });

  it('falls off hard as the tank empties', () => {
    const half = vaporizationCapacity(500, percent(50), fahrenheit(20));
    const low = vaporizationCapacity(500, percent(15), fahrenheit(20));
    expect(low).toBeLessThan(half * 0.7);
  });
});

describe('checkLoad', () => {
  it('passes a house load on a five hundred', () => {
    const result = checkLoad(500, percent(50), fahrenheit(20), 150_000);
    expect(result.sufficient).toBe(true);
    expect(result.headroom).toBeGreaterThan(0);
  });

  it('fails a grain dryer on the same tank at thirty percent', () => {
    const result = checkLoad(500, percent(30), fahrenheit(20), 1_200_000);
    expect(result.sufficient).toBe(false);
    expect(result.headroom).toBeLessThan(0);
  });

  it('names the gauge the tank stops keeping up at', () => {
    const result = checkLoad(500, percent(80), fahrenheit(20), 300_000);
    expect(result.criticalGauge).toBeGreaterThan(0);
    expect(result.criticalGauge).toBeLessThan(80);
  });

  it('reports no critical gauge when the tank never keeps up', () => {
    const result = checkLoad(120, percent(80), fahrenheit(20), 5_000_000);
    expect(result.sufficient).toBe(false);
    expect(result.criticalGauge).toBe(100);
  });

  it('refuses a demand of nothing', () => {
    expect(() => checkLoad(500, percent(50), fahrenheit(20), 0)).toThrowError(/demand/);
  });
});

describe('smallestTankFor', () => {
  it('picks a small tank for a small load', () => {
    expect(smallestTankFor(80_000, fahrenheit(20), percent(30))).toBe(120);
  });

  it('picks a bigger one as the load grows', () => {
    const small = smallestTankFor(80_000, fahrenheit(20), percent(30)) as number;
    const large = smallestTankFor(600_000, fahrenheit(20), percent(30)) as number;
    expect(large).toBeGreaterThan(small);
  });

  it('needs a bigger tank when it is colder', () => {
    const mild = smallestTankFor(400_000, fahrenheit(40), percent(30)) as number;
    const cold = smallestTankFor(400_000, fahrenheit(0), percent(30)) as number;
    expect(cold).toBeGreaterThanOrEqual(mild);
  });

  it('has nothing on the yard for an enormous load', () => {
    expect(smallestTankFor(20_000_000, fahrenheit(20), percent(30))).toBeUndefined();
  });
});
