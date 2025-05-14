import { describe, expect, it } from 'vitest';
import {
  buildFillIntervals,
  countSkipsByReason,
  usableShare,
} from '../../../src/core/fill-intervals';
import { DegreeDayLedger } from '../../../src/core/degree-days';
import { Delivery, DeliveryDraft, makeDelivery } from '../../../src/model/delivery';
import { dayKey, dayRange } from '../../../src/util/dates';
import { fahrenheit } from '../../../src/core/units';
import { ticketNumber } from '../../../src/util/ids';

let serial = 1000;

function fill(overrides: Partial<DeliveryDraft> & { deliveredOn: string }): Delivery {
  serial += 1;
  return makeDelivery({
    id: `d-${serial}`,
    ticketNumber: ticketNumber(serial),
    customerId: 'c-1',
    tankId: 't-1',
    gross: 250,
    meterTemperature: 60,
    gaugeBefore: 25,
    gaugeAfter: 80,
    driverId: 'drv-1',
    truckId: 'B-4',
    ...overrides,
  });
}

/** A ledger with a steady twenty degree days a day, so sums are easy to reason about. */
function steadyLedger(from: string, to: string, gap: readonly string[] = []): DegreeDayLedger {
  const ledger = new DegreeDayLedger('KITH');
  for (const day of dayRange(dayKey(from), dayKey(to))) {
    if (gap.includes(day)) {
      continue;
    }
    ledger.record({ day, high: fahrenheit(55), low: fahrenheit(35) });
  }
  return ledger;
}

describe('buildFillIntervals', () => {
  const ledger = steadyLedger('2024-10-01', '2025-05-01');

  it('pairs consecutive fills into intervals', () => {
    const result = buildFillIntervals(
      [fill({ deliveredOn: '2024-11-01' }), fill({ deliveredOn: '2024-12-01' })],
      ledger,
      80,
    );
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0]).toMatchObject({ days: 30, degreeDays: 600, gallons: 250 });
  });

  it('labels an interval with its two days', () => {
    const result = buildFillIntervals(
      [fill({ deliveredOn: '2024-11-01' }), fill({ deliveredOn: '2024-12-01' })],
      ledger,
      80,
    );
    expect(result.intervals[0]?.label).toBe('2024-11-01..2024-12-01');
  });

  it('counts degree days from the day after the opening fill', () => {
    const result = buildFillIntervals(
      [fill({ deliveredOn: '2024-11-01' }), fill({ deliveredOn: '2024-11-11' })],
      ledger,
      80,
    );
    expect(result.intervals[0]?.degreeDays).toBe(200);
  });

  it('chains three fills into two intervals', () => {
    const result = buildFillIntervals(
      [
        fill({ deliveredOn: '2024-11-01' }),
        fill({ deliveredOn: '2024-12-01' }),
        fill({ deliveredOn: '2025-01-01' }),
      ],
      ledger,
      80,
    );
    expect(result.intervals).toHaveLength(2);
  });

  it('sorts the tickets before pairing them', () => {
    const result = buildFillIntervals(
      [fill({ deliveredOn: '2024-12-01' }), fill({ deliveredOn: '2024-11-01' })],
      ledger,
      80,
    );
    expect(result.intervals[0]?.days).toBe(30);
  });

  it('gives nothing back for a single fill', () => {
    expect(buildFillIntervals([fill({ deliveredOn: '2024-11-01' })], ledger, 80).intervals).toEqual(
      [],
    );
  });
});

describe('intervals that get thrown away', () => {
  const ledger = steadyLedger('2024-10-01', '2025-05-01');

  it('drops an interval whose opening fill stopped short', () => {
    const result = buildFillIntervals(
      [fill({ deliveredOn: '2024-11-01', gaugeAfter: 55 }), fill({ deliveredOn: '2024-12-01' })],
      ledger,
      80,
    );
    expect(result.intervals).toEqual([]);
    expect(result.skipped[0]?.reason).toBe('opening_fill_not_anchored');
  });

  it('drops a top off a few days after a fill', () => {
    const result = buildFillIntervals(
      [fill({ deliveredOn: '2024-11-01' }), fill({ deliveredOn: '2024-11-04' })],
      ledger,
      80,
    );
    expect(result.skipped[0]).toMatchObject({ reason: 'interval_too_short', detail: '3 days' });
  });

  it('drops a gap longer than a year', () => {
    const wide = steadyLedger('2023-01-01', '2025-05-01');
    const result = buildFillIntervals(
      [fill({ deliveredOn: '2023-06-01' }), fill({ deliveredOn: '2024-12-01' })],
      wide,
      80,
    );
    expect(result.skipped[0]?.reason).toBe('interval_too_long');
  });

  it('drops an interval the weather ledger cannot cover', () => {
    const holes = steadyLedger('2024-10-01', '2025-05-01', [
      '2024-11-10',
      '2024-11-11',
      '2024-11-12',
      '2024-11-13',
      '2024-11-14',
    ]);
    const result = buildFillIntervals(
      [fill({ deliveredOn: '2024-11-01' }), fill({ deliveredOn: '2024-12-01' })],
      holes,
      80,
    );
    expect(result.skipped[0]).toMatchObject({ reason: 'weather_gap' });
    expect(result.skipped[0]?.detail).toBe('5 of 30 days missing');
  });

  it('tolerates a gap inside the coverage allowance', () => {
    const holes = steadyLedger('2024-10-01', '2025-05-01', ['2024-11-10', '2024-11-11']);
    const result = buildFillIntervals(
      [fill({ deliveredOn: '2024-11-01' }), fill({ deliveredOn: '2024-12-01' })],
      holes,
      80,
    );
    expect(result.intervals).toHaveLength(1);
  });

  it('leaves a voided ticket out of the chain entirely', () => {
    const result = buildFillIntervals(
      [
        fill({ deliveredOn: '2024-11-01' }),
        fill({ deliveredOn: '2024-11-20', status: 'void' }),
        fill({ deliveredOn: '2024-12-01' }),
      ],
      ledger,
      80,
    );
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0]?.days).toBe(30);
  });

  it('drops a fill of nothing', () => {
    const result = buildFillIntervals(
      [fill({ deliveredOn: '2024-11-01' }), fill({ deliveredOn: '2024-12-01', gross: 0 })],
      ledger,
      80,
    );
    expect(result.skipped[0]?.reason).toBe('no_gallons');
  });

  it('follows the tank filling limit when deciding what anchored', () => {
    const pair = [fill({ deliveredOn: '2024-11-01' }), fill({ deliveredOn: '2024-12-01' })];
    expect(buildFillIntervals(pair, ledger, 85).intervals).toHaveLength(0);
    expect(buildFillIntervals(pair, ledger, 80).intervals).toHaveLength(1);
  });
});

describe('reporting on what was thrown away', () => {
  const ledger = steadyLedger('2024-10-01', '2025-05-01');

  it('measures the share that survived', () => {
    const result = buildFillIntervals(
      [
        fill({ deliveredOn: '2024-11-01' }),
        fill({ deliveredOn: '2024-11-04' }),
        fill({ deliveredOn: '2024-12-05' }),
      ],
      ledger,
      80,
    );
    expect(usableShare(result)).toBeCloseTo(0.5, 6);
  });

  it('is zero when there was nothing to judge', () => {
    expect(usableShare({ intervals: [], skipped: [] })).toBe(0);
  });

  it('counts the reasons', () => {
    const result = buildFillIntervals(
      [
        fill({ deliveredOn: '2024-11-01' }),
        fill({ deliveredOn: '2024-11-04' }),
        fill({ deliveredOn: '2024-11-06' }),
      ],
      ledger,
      80,
    );
    const counts = countSkipsByReason(result);
    expect(counts.interval_too_short).toBe(2);
    expect(counts.weather_gap).toBe(0);
  });
});
