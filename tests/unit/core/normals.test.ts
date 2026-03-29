import { describe, expect, it } from 'vitest';
import { DailyDegreeDays, degreeDaysFor } from '../../../src/core/degree-days';
import { allMonthDays, buildNormals, groupByMonthDay } from '../../../src/core/normals';
import { dayKey, dayRange } from '../../../src/util/dates';
import { fahrenheit } from '../../../src/core/units';

/** A seasonal year with a small wobble, so a normal has something to smooth. */
function history(years: readonly string[], wobble = 0): DailyDegreeDays[] {
  const out: DailyDegreeDays[] = [];
  for (const [yearIndex, year] of years.entries()) {
    for (const day of dayRange(dayKey(`${year}-01-01`), dayKey(`${year}-12-31`))) {
      const dayOfYear = Math.round(
        (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${year}-01-01T00:00:00Z`)) / 86_400_000,
      );
      const seasonal = 46 - 26 * Math.cos((2 * Math.PI * (dayOfYear - 15)) / 365);
      // Deterministic day to day noise, which is the thing a normal has to
      // smooth out. A per year offset would cancel exactly and prove nothing.
      const noise = wobble * Math.sin((dayOfYear * 7 + yearIndex * 13) * 1.7);
      const mean = seasonal + noise;
      out.push(
        degreeDaysFor({
          day,
          high: fahrenheit(Math.round(mean + 8)),
          low: fahrenheit(Math.round(mean - 8)),
        }),
      );
    }
  }
  return out;
}

describe('allMonthDays', () => {
  it('covers a leap year', () => {
    const keys = allMonthDays();
    expect(keys).toHaveLength(366);
    expect(keys).toContain('02-29');
    expect(keys[0]).toBe('01-01');
    expect(keys[keys.length - 1]).toBe('12-31');
  });
});

describe('groupByMonthDay', () => {
  it('collects one entry per year for a day', () => {
    const grouped = groupByMonthDay(history(['2023', '2024', '2025']));
    expect(grouped.get('01-15')).toHaveLength(3);
  });

  it('has nothing for a day never observed', () => {
    expect(groupByMonthDay([]).get('01-15')).toBeUndefined();
  });
});

describe('buildNormals', () => {
  it('produces a normal for every day observed', () => {
    const { normals, summary } = buildNormals('KITH', history(['2023', '2024', '2025']));
    expect(summary.days).toBeGreaterThan(360);
    expect(normals.forDay(dayKey('2030-01-15'))).toBeGreaterThan(0);
  });

  it('is colder in january than in july', () => {
    const { normals } = buildNormals('KITH', history(['2023', '2024', '2025']));
    expect(normals.forDay(dayKey('2030-01-15'))).toBeGreaterThan(
      normals.forDay(dayKey('2030-07-15')),
    );
  });

  it('smooths out the year to year wobble', () => {
    const raw = buildNormals('KITH', history(['2023', '2024'], 9), { windowDays: 0 });
    const smoothed = buildNormals('KITH', history(['2023', '2024'], 9), { windowDays: 10 });
    const jitter = (source: typeof raw) => {
      let total = 0;
      for (let day = 2; day <= 27; day += 1) {
        const key = `2030-01-${String(day).padStart(2, '0')}`;
        const previous = `2030-01-${String(day - 1).padStart(2, '0')}`;
        total += Math.abs(
          source.normals.forDay(dayKey(key)) - source.normals.forDay(dayKey(previous)),
        );
      }
      return total;
    };
    expect(jitter(smoothed)).toBeLessThanOrEqual(jitter(raw));
  });

  it('fills the leap day from its neighbours when there is almost no history', () => {
    const { summary, normals } = buildNormals('KITH', history(['2023', '2025']));
    expect(summary.filledFromNeighbours).toContain('02-29');
    expect(normals.forDay(dayKey('2028-02-29'))).toBeGreaterThan(0);
  });

  it('does not let the leap day pull its neighbours around', () => {
    const withLeap = buildNormals('KITH', history(['2024']));
    expect(withLeap.normals.forDay(dayKey('2030-02-28'))).toBeGreaterThan(0);
    expect(withLeap.normals.forDay(dayKey('2030-03-01'))).toBeGreaterThan(0);
  });

  it('has nothing to say about no history at all', () => {
    const { normals, summary } = buildNormals('KITH', []);
    expect(normals.size).toBe(0);
    expect(summary.observations).toBe(0);
    expect(summary.seasonTotal).toBe(0);
  });

  it('reports the total heating a normal year carries', () => {
    const { summary } = buildNormals('KITH', history(['2023', '2024', '2025']));
    expect(summary.seasonTotal).toBeGreaterThan(4000);
    expect(summary.seasonTotal).toBeLessThan(10_000);
  });

  it('refuses a window that is not a window', () => {
    expect(() => buildNormals('KITH', [], { windowDays: -1 })).toThrowError(/window days/);
    expect(() => buildNormals('KITH', [], { minimumObservations: 0 })).toThrowError(
      /minimum observations/,
    );
  });
});
