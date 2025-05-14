import { describe, expect, it } from 'vitest';
import { FillInterval, fitBurnModel, median, predictGallons } from '../../../src/core/burn-model';
import { InsufficientHistoryError } from '../../../src/core/errors';

/** Builds intervals from a known truth so the fit can be checked against it. */
function synth(
  base: number,
  weather: number,
  shape: readonly (readonly [number, number])[],
): FillInterval[] {
  return shape.map(([days, degreeDays], index) => ({
    days,
    degreeDays,
    gallons: base * days + weather * degreeDays,
    label: `i-${index}`,
  }));
}

const winterAndSummer: readonly (readonly [number, number])[] = [
  [28, 980],
  [35, 1120],
  [42, 610],
  [60, 90],
  [75, 0],
  [31, 840],
];

describe('fitBurnModel', () => {
  it('recovers a known base load and weather term', () => {
    const model = fitBurnModel(synth(1.4, 0.32, winterAndSummer), 't-1');
    expect(model.baseGallonsPerDay).toBeCloseTo(1.4, 6);
    expect(model.weatherGallonsPerDegreeDay).toBeCloseTo(0.32, 6);
    expect(model.intervalsUsed).toBe(6);
    expect(model.intervalsRejected).toBe(0);
  });

  it('reports the k factor as the reciprocal of the weather term', () => {
    const model = fitBurnModel(synth(1.4, 0.32, winterAndSummer), 't-1');
    expect(model.kFactor).toBeCloseTo(1 / 0.32, 4);
  });

  it('fits a clean history perfectly', () => {
    expect(fitBurnModel(synth(1.4, 0.32, winterAndSummer), 't-1').fitQuality).toBeCloseTo(1, 6);
  });

  it('refuses to guess from too little history', () => {
    expect(() => fitBurnModel(synth(1.4, 0.32, winterAndSummer.slice(0, 2)), 't-9')).toThrowError(
      InsufficientHistoryError,
    );
    expect(() => fitBurnModel([], 't-9')).toThrowError(/needs 3/);
  });

  it('ignores intervals that cannot be real', () => {
    const intervals = [
      ...synth(1.4, 0.32, winterAndSummer),
      { days: 0, degreeDays: 500, gallons: 200 },
      { days: 30, degreeDays: 500, gallons: 0 },
    ];
    expect(fitBurnModel(intervals, 't-1').intervalsUsed).toBe(6);
  });

  it('takes a higher minimum when the caller wants more evidence', () => {
    expect(() =>
      fitBurnModel(synth(1.4, 0.32, winterAndSummer.slice(0, 4)), 't-1', { minimumIntervals: 5 }),
    ).toThrowError(/needs 5/);
  });
});

describe('outlier rejection', () => {
  it('drops a fill somebody keyed wrong and refits', () => {
    const intervals = synth(1.4, 0.32, winterAndSummer);
    const wrong = { ...(intervals[2] as FillInterval), gallons: 2400, label: 'fat-finger' };
    const model = fitBurnModel([...intervals.slice(0, 2), wrong, ...intervals.slice(3)], 't-1');
    expect(model.intervalsRejected).toBe(1);
    expect(model.baseGallonsPerDay).toBeCloseTo(1.4, 4);
    expect(model.weatherGallonsPerDegreeDay).toBeCloseTo(0.32, 4);
  });

  it('keeps everything when nothing is out of line', () => {
    expect(fitBurnModel(synth(1.4, 0.32, winterAndSummer), 't-1').intervalsRejected).toBe(0);
  });

  it('will not reject its way below the minimum', () => {
    const intervals = synth(1.4, 0.32, winterAndSummer.slice(0, 3));
    const wrecked = [...intervals];
    wrecked[0] = { ...(wrecked[0] as FillInterval), gallons: 9000 };
    const model = fitBurnModel(wrecked, 't-1');
    expect(model.intervalsUsed).toBe(3);
    expect(model.intervalsRejected).toBe(0);
  });
});

describe('degenerate histories', () => {
  it('falls back to a weather only fit when every interval is a winter one', () => {
    const winterOnly: readonly (readonly [number, number])[] = [
      [30, 900],
      [30, 900],
      [30, 900],
    ];
    const model = fitBurnModel(synth(0, 0.3, winterOnly), 't-1');
    expect(model.weatherGallonsPerDegreeDay).toBeCloseTo(0.3, 6);
  });

  it('reports no k factor for a tank with no weather load at all', () => {
    const summerOnly: readonly (readonly [number, number])[] = [
      [30, 0],
      [45, 0],
      [60, 0],
    ];
    const model = fitBurnModel(synth(1.6, 0, summerOnly), 't-1');
    expect(model.baseGallonsPerDay).toBeCloseTo(1.6, 6);
    expect(model.weatherGallonsPerDegreeDay).toBe(0);
    expect(model.kFactor).toBeUndefined();
  });

  it('never produces a negative term', () => {
    const odd: FillInterval[] = [
      { days: 30, degreeDays: 900, gallons: 50 },
      { days: 60, degreeDays: 100, gallons: 400 },
      { days: 45, degreeDays: 500, gallons: 120 },
      { days: 20, degreeDays: 700, gallons: 60 },
    ];
    const model = fitBurnModel(odd, 't-1');
    expect(model.baseGallonsPerDay).toBeGreaterThanOrEqual(0);
    expect(model.weatherGallonsPerDegreeDay).toBeGreaterThanOrEqual(0);
  });

  it('caps a base load that would be absurd for a house', () => {
    const intervals: FillInterval[] = [
      { days: 10, degreeDays: 10, gallons: 900 },
      { days: 12, degreeDays: 12, gallons: 1080 },
      { days: 14, degreeDays: 9, gallons: 1250 },
    ];
    const model = fitBurnModel(intervals, 't-1', { maximumBaseGallonsPerDay: 12 });
    expect(model.baseGallonsPerDay).toBeLessThanOrEqual(12);
  });
});

describe('predictGallons', () => {
  it('adds the two terms', () => {
    const model = fitBurnModel(synth(1.4, 0.32, winterAndSummer), 't-1');
    expect(predictGallons(model, 30, 800)).toBeCloseTo(1.4 * 30 + 0.32 * 800, 4);
  });

  it('is just the base load over a stretch with no degree days', () => {
    const model = fitBurnModel(synth(1.4, 0.32, winterAndSummer), 't-1');
    expect(predictGallons(model, 30, 0)).toBeCloseTo(42, 4);
  });

  it('refuses a negative span', () => {
    const model = fitBurnModel(synth(1.4, 0.32, winterAndSummer), 't-1');
    expect(() => predictGallons(model, -1, 100)).toThrowError(/days/);
    expect(() => predictGallons(model, 10, -1)).toThrowError(/degree days/);
  });
});

describe('median', () => {
  it('takes the middle of an odd list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the middle two of an even list', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('has nothing to say about an empty list', () => {
    expect(median([])).toBe(0);
  });
});
