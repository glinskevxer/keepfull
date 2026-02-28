import { afterEach, describe, expect, it } from 'vitest';
import { ReportService } from '../../../src/service/reports';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { makeDriver, makeTruck } from '../../../src/model/fleet';
import { makeRoute } from '../../../src/model/route';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({
    today: '2026-03-31',
    weatherFrom: '2024-07-01',
    weatherTo: '2026-04-01',
  });
  return { scenario, reports: new ReportService(scenario.context) };
}

describe('gallonsByMonth', () => {
  it('groups by calendar month, oldest first', () => {
    const { scenario, reports } = setup();
    scenario.fill('2026-01-05', 200, { meterTemperature: 60 });
    scenario.fill('2026-01-20', 100, { meterTemperature: 60 });
    scenario.fill('2026-02-05', 300, { meterTemperature: 60 });
    const rows = reports.gallonsByMonth(dayKey('2026-01-01'), dayKey('2026-03-01'));
    expect(rows.map((row) => row.period)).toEqual(['2026-01', '2026-02']);
    expect(rows[0]).toMatchObject({ tickets: 2, netGallons: 300, averageDrop: 150 });
  });

  it('reports what the temperature correction moved', () => {
    const { scenario, reports } = setup();
    scenario.fill('2026-01-05', 300, { meterTemperature: 20 });
    const row = reports.gallonsByMonth(dayKey('2026-01-01'), dayKey('2026-02-01'))[0];
    expect(row?.correctionGallons).toBeGreaterThan(0);
    expect(row?.netGallons).toBeGreaterThan(row?.grossGallons as number);
  });

  it('leaves a voided ticket out', () => {
    const { scenario, reports } = setup();
    scenario.fill('2026-01-05', 200, { meterTemperature: 60 });
    scenario.fill('2026-01-06', 999, { meterTemperature: 60, status: 'void' });
    expect(reports.gallonsByMonth(dayKey('2026-01-01'), dayKey('2026-02-01'))[0]?.tickets).toBe(1);
  });

  it('has nothing to say about a quiet range', () => {
    const { reports } = setup();
    expect(reports.gallonsByMonth(dayKey('2026-01-01'), dayKey('2026-02-01'))).toEqual([]);
  });
});

describe('gallonsBySeason', () => {
  it('puts a january with the december before it', () => {
    const { scenario, reports } = setup();
    scenario.fill('2025-12-10', 200, { meterTemperature: 60 });
    scenario.fill('2026-01-10', 100, { meterTemperature: 60 });
    scenario.fill('2026-08-10', 50, { meterTemperature: 60 });
    const rows = reports.gallonsBySeason(dayKey('2025-07-01'), dayKey('2026-12-31'));
    expect(rows.map((row) => row.period)).toEqual(['2025/26', '2026/27']);
    expect(rows[0]?.netGallons).toBe(300);
  });
});

describe('seasonComparison', () => {
  it('divides gallons by degree days', () => {
    const { scenario, reports } = setup();
    scenario.fill('2025-12-10', 200, { meterTemperature: 60 });
    const rows = reports.seasonComparison('KITH', [2025]);
    expect(rows[0]?.label).toBe('2025/26');
    expect(rows[0]?.degreeDays).toBeGreaterThan(0);
    expect(rows[0]?.gallonsPerDegreeDay).toBeCloseTo(200 / (rows[0]?.degreeDays as number), 4);
  });

  it('reports nothing per degree day when there was no weather', () => {
    const { reports } = setup();
    expect(reports.seasonComparison('KITH', [2019])[0]?.gallonsPerDegreeDay).toBeNull();
  });

  it('refuses a station it does not know', () => {
    const { reports } = setup();
    expect(() => reports.seasonComparison('KBUF', [2025])).toThrowError(/no station with id KBUF/);
  });
});

describe('deliveryAccuracy', () => {
  it('is zero when the gauge and the meter agree', () => {
    const { scenario, reports } = setup();
    // A 500 gallon tank going 20 to 80 is 300 gallons by the gauge.
    scenario.fill('2026-01-05', 300, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
    const result = reports.deliveryAccuracy(dayKey('2026-01-01'), dayKey('2026-02-01'));
    expect(result.withBothGauges).toBe(1);
    expect(result.meanAbsoluteGallons).toBe(0);
  });

  it('shows the sign when the meter runs rich', () => {
    const { scenario, reports } = setup();
    scenario.fill('2026-01-05', 320, { meterTemperature: 60, gaugeBefore: 20, gaugeAfter: 80 });
    const result = reports.deliveryAccuracy(dayKey('2026-01-01'), dayKey('2026-02-01'));
    expect(result.meanSignedGallons).toBe(20);
    expect(result.worst[0]?.differenceGallons).toBe(20);
  });

  it('skips tickets with no gauges', () => {
    const { scenario, reports } = setup();
    scenario.fill('2026-01-05', 300, {
      meterTemperature: 60,
      gaugeBefore: undefined,
      gaugeAfter: undefined,
    });
    const result = reports.deliveryAccuracy(dayKey('2026-01-01'), dayKey('2026-02-01'));
    expect(result.tickets).toBe(1);
    expect(result.withBothGauges).toBe(0);
    expect(result.meanAbsoluteGallons).toBe(0);
  });

  it('can be narrowed to one truck', () => {
    const { scenario, reports } = setup();
    scenario.fill('2026-01-05', 300, { meterTemperature: 60, truckId: 'b-4' });
    scenario.fill('2026-01-06', 300, { meterTemperature: 60, truckId: 'b-7' });
    expect(
      reports.deliveryAccuracy(dayKey('2026-01-01'), dayKey('2026-02-01'), 'b-7').tickets,
    ).toBe(1);
  });
});

describe('routeEfficiency', () => {
  function withRoute() {
    const context = setup();
    const { scenario } = context;
    scenario.context.fleet.saveTruck(
      makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
    );
    scenario.context.fleet.saveDriver(
      makeDriver({ id: 'drv-3', name: 'R Vandemark', licenceNumber: 'NY-1' }),
    );
    scenario.fill('2026-01-05', 280, { meterTemperature: 60 });
    const delivery = scenario.context.deliveries.list()[0];
    scenario.context.routes.save(
      makeRoute({
        id: 'rt-1',
        truckId: 'b-4',
        runOn: '2026-01-05',
        plannedMiles: 40,
        stops: [
          {
            id: 'rt-1-s1',
            tankId: scenario.tank.id,
            customerId: scenario.customer.id,
            plannedGallons: 300,
            outcome: 'delivered',
            deliveryId: delivery?.id as string,
          },
        ],
      }),
    );
    return context;
  }

  it('compares delivered against planned', () => {
    const { reports } = withRoute();
    const result = reports.routeEfficiency(dayKey('2026-01-01'), dayKey('2026-02-01'));
    expect(result).toMatchObject({
      routes: 1,
      stops: 1,
      plannedGallons: 300,
      deliveredGallons: 280,
    });
    expect(result.fillRate).toBeCloseTo(0.9333, 3);
  });

  it('reports gallons per mile', () => {
    const { reports } = withRoute();
    expect(reports.routeEfficiency(dayKey('2026-01-01'), dayKey('2026-02-01')).gallonsPerMile).toBe(
      7,
    );
  });

  it('counts the stops the driver could not make', () => {
    const { scenario, reports } = withRoute();
    scenario.context.routes.settleStop('rt-1-s1', 'no_access');
    const result = reports.routeEfficiency(dayKey('2026-01-01'), dayKey('2026-02-01'));
    expect(result.missedStops).toBe(1);
    expect(result.deliveredGallons).toBe(0);
  });

  it('ignores a cancelled route', () => {
    const { scenario, reports } = withRoute();
    scenario.context.routes.setStatus('rt-1', 'cancelled');
    expect(reports.routeEfficiency(dayKey('2026-01-01'), dayKey('2026-02-01')).routes).toBe(0);
  });

  it('reports nothing per mile when there were no routes', () => {
    const { reports } = setup();
    const result = reports.routeEfficiency(dayKey('2026-01-01'), dayKey('2026-02-01'));
    expect(result.fillRate).toBeNull();
    expect(result.gallonsPerMile).toBeNull();
  });
});

describe('trailingMonth', () => {
  it('is thirty days ending today', () => {
    const { reports } = setup();
    expect(reports.trailingMonth()).toEqual({ from: '2026-03-02', to: '2026-03-31', days: 30 });
  });

  it('takes an explicit day', () => {
    const { reports } = setup();
    expect(reports.trailingMonth(dayKey('2026-01-31')).from).toBe('2026-01-02');
  });
});
