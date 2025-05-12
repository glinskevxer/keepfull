import { describe, expect, it } from 'vitest';
import {
  TankReading,
  TankReadingDraft,
  ageInDays,
  bestReading,
  isMeasured,
  isStale,
  makeReading,
  preferReading,
  sourceRank,
} from '../../../src/model/reading';
import { dayKey } from '../../../src/util/dates';

const draft: TankReadingDraft = {
  id: 'r-1',
  tankId: 't-1',
  takenOn: '2025-01-10',
  gauge: 42,
  source: 'driver',
};

function make(overrides: Partial<TankReadingDraft> = {}): TankReading {
  return makeReading({ ...draft, ...overrides });
}

describe('makeReading', () => {
  it('keeps the gauge and the day', () => {
    const reading = make();
    expect(reading.gauge).toBe(42);
    expect(reading.takenOn).toBe('2025-01-10');
  });

  it('refuses a source it does not know', () => {
    expect(() => make({ source: 'guess' as never })).toThrowError(/not a reading source/);
  });

  it('refuses a gauge off the dial', () => {
    expect(() => make({ gauge: 120 })).toThrowError(/between 0 and 100/);
  });

  it('refuses a day that is not a day', () => {
    expect(() => make({ takenOn: 'tuesday' })).toThrowError(/reading could be taken/);
  });

  it('insists a monitor reading names its monitor', () => {
    expect(() => make({ source: 'monitor' })).toThrowError(/which monitor it came from/);
    expect(make({ source: 'monitor', monitorId: 'WT-4471' }).monitorId).toBe('WT-4471');
  });
});

describe('sourceRank', () => {
  it('trusts the monitor most and the forecast least', () => {
    expect(sourceRank('monitor')).toBeLessThan(sourceRank('driver'));
    expect(sourceRank('driver')).toBeLessThan(sourceRank('customer'));
    expect(sourceRank('customer')).toBeLessThan(sourceRank('estimated'));
  });
});

describe('isMeasured', () => {
  it('is false only for the forecast talking to itself', () => {
    expect(isMeasured(make({ source: 'customer' }))).toBe(true);
    expect(isMeasured(make({ source: 'estimated' }))).toBe(false);
  });
});

describe('preferReading', () => {
  it('takes the later day', () => {
    const older = make({ id: 'a', takenOn: '2025-01-10' });
    const newer = make({ id: 'b', takenOn: '2025-01-12', source: 'customer' });
    expect(preferReading(older, newer).id).toBe('b');
    expect(preferReading(newer, older).id).toBe('b');
  });

  it('breaks a tie on the day by trusting the better source', () => {
    const phoned = make({ id: 'a', source: 'customer' });
    const monitored = make({ id: 'b', source: 'monitor', monitorId: 'WT-1' });
    expect(preferReading(phoned, monitored).id).toBe('b');
    expect(preferReading(monitored, phoned).id).toBe('b');
  });
});

describe('bestReading', () => {
  it('finds the one to act on', () => {
    const readings = [
      make({ id: 'a', takenOn: '2025-01-08', source: 'monitor', monitorId: 'WT-1' }),
      make({ id: 'b', takenOn: '2025-01-11', source: 'estimated' }),
      make({ id: 'c', takenOn: '2025-01-11', source: 'driver' }),
    ];
    expect(bestReading(readings)?.id).toBe('c');
  });

  it('has nothing to say about an empty list', () => {
    expect(bestReading([])).toBeUndefined();
  });
});

describe('staleness', () => {
  it('counts the days', () => {
    expect(ageInDays(make(), dayKey('2025-01-15'))).toBe(5);
  });

  it('goes stale after five days by default', () => {
    expect(isStale(make(), dayKey('2025-01-15'))).toBe(false);
    expect(isStale(make(), dayKey('2025-01-16'))).toBe(true);
  });

  it('takes a tighter window', () => {
    expect(isStale(make(), dayKey('2025-01-12'), 1)).toBe(true);
  });
});
