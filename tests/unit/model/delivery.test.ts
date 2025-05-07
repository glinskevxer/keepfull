import { describe, expect, it } from 'vitest';
import {
  ANCHOR_TOLERANCE_PERCENT,
  Delivery,
  DeliveryDraft,
  compareByDay,
  gaugeRise,
  impliedNetGallons,
  isAnchorFill,
  isPosted,
  makeDelivery,
  voided,
} from '../../../src/model/delivery';
import { ticketNumber } from '../../../src/util/ids';

const draft: DeliveryDraft = {
  id: 'd-1',
  ticketNumber: ticketNumber(884_120),
  customerId: 'c-1',
  tankId: 't-1',
  deliveredOn: '2025-01-14',
  gross: 312.4,
  meterTemperature: 28,
  gaugeBefore: 22,
  gaugeAfter: 80,
  driverId: 'drv-3',
  truckId: 'B-4',
};

function make(overrides: Partial<DeliveryDraft> = {}): Delivery {
  return makeDelivery({ ...draft, ...overrides });
}

/** Builds a ticket with some of the optional fields simply absent. */
function makeWithout(...omit: (keyof DeliveryDraft)[]): Delivery {
  const copy: Record<string, unknown> = { ...draft };
  for (const key of omit) {
    delete copy[key];
  }
  return makeDelivery(copy as unknown as DeliveryDraft);
}

describe('makeDelivery', () => {
  it('corrects the metered gallons to sixty degrees', () => {
    const delivery = make();
    expect(delivery.gross).toBe(312.4);
    expect(delivery.net).toBeGreaterThan(delivery.gross);
  });

  it('defaults to a scheduled, posted ticket', () => {
    expect(make().reason).toBe('scheduled');
    expect(make().status).toBe('posted');
  });

  it('refuses a ticket number that fails its check digit', () => {
    expect(() => make({ ticketNumber: '00088412' })).toThrowError(/does not check out/);
  });

  it('refuses a reason it does not know', () => {
    expect(() => make({ reason: 'because' as never })).toThrowError(/not a reason to fill/);
  });

  it('refuses a status it does not know', () => {
    expect(() => make({ status: 'pending' as never })).toThrowError(/not a ticket status/);
  });

  it('refuses a delivery day that is not a day', () => {
    expect(() => make({ deliveredOn: 'yesterday' })).toThrowError(/not a delivery day/);
  });

  it('refuses a gauge that fell over a fill', () => {
    expect(() => make({ gaugeBefore: 60, gaugeAfter: 40 })).toThrowError(/cannot read lower after/);
  });

  it('accepts a ticket with no gauge readings at all', () => {
    const delivery = makeWithout('gaugeBefore', 'gaugeAfter');
    expect(delivery.gaugeBefore).toBeUndefined();
    expect(gaugeRise(delivery)).toBeUndefined();
  });

  it('refuses a negative drop', () => {
    expect(() => make({ gross: -5 })).toThrowError(/gross gallons/);
  });
});

describe('isAnchorFill', () => {
  it('accepts a fill that reached the limit', () => {
    expect(isAnchorFill(make({ gaugeAfter: 80 }), 80)).toBe(true);
  });

  it('accepts a fill that stopped just inside the tolerance', () => {
    expect(isAnchorFill(make({ gaugeAfter: 80 - ANCHOR_TOLERANCE_PERCENT }), 80)).toBe(true);
  });

  it('rejects a fill that stopped short', () => {
    expect(isAnchorFill(make({ gaugeAfter: 62 }), 80)).toBe(false);
  });

  it('rejects a fill with no closing gauge', () => {
    expect(isAnchorFill(makeWithout('gaugeAfter'), 80)).toBe(false);
  });

  it('rejects a voided ticket however full the tank ended up', () => {
    expect(isAnchorFill(make({ status: 'void' }), 80)).toBe(false);
  });

  it('rejects the first fill on a new tank', () => {
    expect(isAnchorFill(make({ reason: 'new_tank' }), 80)).toBe(false);
    expect(isAnchorFill(make({ reason: 'tank_swap' }), 80)).toBe(false);
  });

  it('follows the tank rather than a fixed eighty', () => {
    expect(isAnchorFill(make({ gaugeAfter: 82 }), 85)).toBe(true);
    expect(isAnchorFill(make({ gaugeAfter: 80 }), 85)).toBe(false);
  });
});

describe('gaugeRise and impliedNetGallons', () => {
  it('measures the movement', () => {
    expect(gaugeRise(make())).toBe(58);
  });

  it('turns the movement into gallons', () => {
    expect(impliedNetGallons(make(), 500)).toBe(290);
  });

  it('reports nothing when a reading is missing', () => {
    expect(impliedNetGallons(makeWithout('gaugeBefore'), 500)).toBeUndefined();
  });
});

describe('voided', () => {
  it('flips the status and keeps the note', () => {
    const gone = voided(make(), 'wrong tank');
    expect(gone.status).toBe('void');
    expect(gone.notes).toBe('wrong tank');
    expect(isPosted(gone)).toBe(false);
  });

  it('insists on a reason', () => {
    expect(() => voided(make(), '')).toThrowError(/void note/);
  });

  it('leaves the original alone', () => {
    const original = make();
    voided(original, 'wrong tank');
    expect(original.status).toBe('posted');
  });
});

describe('compareByDay', () => {
  it('sorts by day then by ticket number', () => {
    const first = make({ deliveredOn: '2025-01-14', ticketNumber: ticketNumber(1) });
    const second = make({ deliveredOn: '2025-01-14', ticketNumber: ticketNumber(2) });
    const later = make({ deliveredOn: '2025-02-01', ticketNumber: ticketNumber(1) });
    expect([later, second, first].sort(compareByDay).map((d) => d.ticketNumber)).toEqual([
      first.ticketNumber,
      second.ticketNumber,
      later.ticketNumber,
    ]);
  });
});
