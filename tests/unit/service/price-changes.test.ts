import { afterEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../../src/service/audit';
import { PriceChangeService } from '../../../src/service/price-changes';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeSchedule } from '../../../src/core/pricing';
import { mills, parseMills } from '../../../src/util/money';

afterEach(closeTestDatabases);

function setup(classes: string[] = ['residential', 'agricultural']) {
  const scenario = buildScenario({ today: '2026-05-14', weatherFrom: '2024-07-01' });
  for (const rateClass of classes) {
    scenario.context.pricing.saveSchedule(
      makeSchedule({
        id: `ps-${rateClass}`,
        rateClass: rateClass as never,
        effectiveFrom: dayKey('2026-01-01'),
        tiers: [
          { fromGallons: 0, pricePerGallon: parseMills('3.4990') },
          { fromGallons: 300, pricePerGallon: parseMills('2.9990') },
        ],
      }),
    );
  }
  return { scenario, service: new PriceChangeService(scenario.context) };
}

describe('apply', () => {
  it('moves every tier by the same amount', () => {
    const { service } = setup();
    const result = service.apply({
      deltaPerGallon: mills(1000),
      effectiveFrom: dayKey('2026-06-01'),
    });
    const residential = result.changed.find((entry) => entry.rateClass === 'residential');
    expect(residential?.newTiers).toEqual([35_990, 30_990]);
  });

  it('brings the price down on a negative delta', () => {
    const { service } = setup();
    const result = service.apply({
      deltaPerGallon: mills(-1000),
      effectiveFrom: dayKey('2026-06-01'),
    });
    expect(result.changed[0]?.newTiers[0]).toBe(33_990);
  });

  it('never takes a tier below a tenth of a cent', () => {
    const { service } = setup();
    const result = service.apply({
      deltaPerGallon: mills(-99_999),
      effectiveFrom: dayKey('2026-06-01'),
    });
    expect(result.changed[0]?.newTiers.every((price) => price >= 1)).toBe(true);
  });

  it('supersedes rather than editing', () => {
    const { scenario, service } = setup();
    service.apply({ deltaPerGallon: mills(1000), effectiveFrom: dayKey('2026-06-01') });
    expect(scenario.context.pricing.getSchedule('ps-residential').tiers[0]?.pricePerGallon).toBe(
      34_990,
    );
    expect(
      scenario.context.pricing.scheduleInForce('residential', dayKey('2026-06-02'))?.tiers[0]
        ?.pricePerGallon,
    ).toBe(35_990);
  });

  it('leaves the old price in force until the day it changes', () => {
    const { scenario, service } = setup();
    service.apply({ deltaPerGallon: mills(1000), effectiveFrom: dayKey('2026-06-01') });
    expect(scenario.context.pricing.scheduleInForce('residential', dayKey('2026-05-31'))?.id).toBe(
      'ps-residential',
    );
  });

  it('covers every rate class by default', () => {
    const { service } = setup(['residential', 'agricultural']);
    const result = service.apply({
      deltaPerGallon: mills(500),
      effectiveFrom: dayKey('2026-06-01'),
    });
    expect(result.changed).toHaveLength(2);
    expect(result.skipped.map((entry) => entry.rateClass).sort()).toEqual(['commercial', 'resale']);
  });

  it('can be narrowed to one class', () => {
    const { service } = setup();
    const result = service.apply({
      deltaPerGallon: mills(500),
      effectiveFrom: dayKey('2026-06-01'),
      rateClasses: ['residential'],
    });
    expect(result.changed).toHaveLength(1);
  });

  it('refuses a backdated change', () => {
    const { service } = setup();
    expect(() =>
      service.apply({ deltaPerGallon: mills(500), effectiveFrom: dayKey('2026-05-01') }),
    ).toThrowError(/cannot be backdated/);
  });

  it('refuses a change naming no classes', () => {
    const { service } = setup();
    expect(() =>
      service.apply({
        deltaPerGallon: mills(500),
        effectiveFrom: dayKey('2026-06-01'),
        rateClasses: [],
      }),
    ).toThrowError(/at least one rate class/);
  });

  it('skips a class that already has a schedule on that day', () => {
    const { service } = setup();
    service.apply({ deltaPerGallon: mills(500), effectiveFrom: dayKey('2026-06-01') });
    const second = service.apply({
      deltaPerGallon: mills(500),
      effectiveFrom: dayKey('2026-06-01'),
    });
    expect(second.changed).toEqual([]);
    expect(second.skipped[0]?.reason).toMatch(/already starts on 2026-06-01/);
  });

  it('leaves an audit entry per class', () => {
    const { scenario, service } = setup();
    const result = service.apply({
      deltaPerGallon: mills(500),
      effectiveFrom: dayKey('2026-06-01'),
      note: 'wholesale moved',
    });
    const audit = new AuditService(scenario.context);
    const entry = audit.history('price', result.changed[0]?.toScheduleId as string)[0];
    expect(entry?.action).toBe('price_change');
    expect(entry?.note).toBe('wholesale moved');
  });

  it('says so in the log', () => {
    const { scenario, service } = setup();
    service.apply({ deltaPerGallon: mills(500), effectiveFrom: dayKey('2026-06-01') });
    expect(scenario.sink.messages()).toContain('moved the posted price');
  });
});

describe('impact', () => {
  it('is nothing on a book that has burned nothing', () => {
    const { service } = setup();
    expect(service.impact(mills(1000), 2025).every((row) => row.annualImpact === 0)).toBe(true);
  });

  it('values a rise against last season gallons', () => {
    const { scenario, service } = setup();
    scenario.fill('2025-12-01', 400, { meterTemperature: 60 });
    const row = service
      .impact(mills(1000), 2025)
      .find((entry) => entry.rateClass === 'agricultural');
    expect(row?.gallonsLastSeason).toBe(400);
    expect(row?.annualImpact).toBe(4000);
  });

  it('values a cut as a loss', () => {
    const { scenario, service } = setup();
    scenario.fill('2025-12-01', 400, { meterTemperature: 60 });
    const row = service
      .impact(mills(-1000), 2025)
      .find((entry) => entry.rateClass === 'agricultural');
    expect(row?.annualImpact).toBe(-4000);
  });
});

describe('nextWeek', () => {
  it('dates the change a week out', () => {
    const { service } = setup();
    expect(service.nextWeek(mills(500)).effectiveFrom).toBe('2026-05-21');
  });
});
