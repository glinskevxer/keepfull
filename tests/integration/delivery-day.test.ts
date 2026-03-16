import { afterEach, describe, expect, it } from 'vitest';
import { AppContext, buildContext } from '../../src/service/context';
import { DeliveryService } from '../../src/service/deliveries';
import { DispatchService } from '../../src/service/dispatch';
import { ForecastingService } from '../../src/service/forecasting';
import { IdFactory, ticketNumber } from '../../src/util/ids';
import { Logger, MemorySink } from '../../src/util/logger';
import { ReconciliationService } from '../../src/service/reconciliation';
import { ReportService } from '../../src/service/reports';
import { RoutingService } from '../../src/service/routing';
import { closeTestDatabases, testDatabase } from '../support/db';
import { DayKey, dayKey } from '../../src/util/dates';
import { makeTruckLoad } from '../../src/model/truck-load';
import { seed } from '../../src/dev/seed';

afterEach(closeTestDatabases);

const TODAY = dayKey('2026-01-20');
const YARD = { latitude: 42.4432, longitude: -76.5019 };

interface Yard {
  readonly context: AppContext;
  readonly sink: MemorySink;
}

function buildYard(): Yard {
  const sink = new MemorySink();
  const context = buildContext(testDatabase(), {
    logger: new Logger({ sink, level: 'debug' }),
    ids: new IdFactory({ now: () => 1_700_000_000_000 }, () => 0.5),
    clock: () => new Date(`${TODAY}T06:00:00.000Z`),
  });
  seed(context, { customers: 12, from: dayKey('2024-06-01'), to: TODAY, seed: 4471 });
  return { context, sink };
}

/**
 * One whole day, start to finish: forecast the book, plan it onto the trucks,
 * commit and release the routes, post what the drivers wrote, close the routes
 * out and reconcile the loads against the tickets.
 *
 * This exists because every part of that chain is unit tested and the chain
 * itself was still wrong twice: once because dispatch sized drops off a gauge
 * the ticket then contradicted, and once because closing a route left a stop
 * pending that nothing ever looked at again.
 */
describe('a delivery day, end to end', () => {
  it('forecasts, plans, delivers, closes and reconciles', () => {
    const { context } = buildYard();

    // The book can be forecast.
    const forecasting = new ForecastingService(context);
    const tanks = context.tanks.list({ inServiceOnly: true });
    const forecastable = tanks.filter((tank) => forecasting.tryForTank(tank.id, { asOf: TODAY }));
    expect(forecastable.length).toBeGreaterThan(tanks.length / 2);

    // Dispatch finds work and fits it onto the trucks.
    const dispatch = new DispatchService(context, YARD);
    const plan = dispatch.plan({ asOf: TODAY, windowDays: 21 });
    const planned = plan.plan.routes.flatMap((route) => route.stops);
    expect(planned.length).toBeGreaterThan(0);
    for (const route of plan.plan.routes) {
      const capacity = dispatch.truckCapacities().find((truck) => truck.truckId === route.truckId)
        ?.gallons as number;
      expect(route.plannedGallons).toBeLessThanOrEqual(capacity);
    }

    // Committing turns it into routes somebody drives.
    const routing = new RoutingService(context);
    const routes = routing.commit(plan, { drivers: { 'trk-b4': 'drv-1', 'trk-b7': 'drv-2' } });
    expect(routes.length).toBeGreaterThan(0);
    const runOn = routes[0]?.runOn as DayKey;

    for (const route of routes) {
      routing.release(route.id);
      expect(context.routes.get(route.id).status).toBe('released');
    }

    // The plant loads the trucks.
    let meter = 500_000;
    for (const route of routes) {
      context.loads.insert(
        makeTruckLoad({
          id: context.ids.next('ld'),
          truckId: route.truckId,
          driverId: route.driverId as string,
          loadedOn: runOn,
          plantGross: Math.ceil(route.plannedGallons) + 40,
          plantTemperature: 40,
          meterStart: meter,
        }),
      );
      meter += 1_000_000;
    }

    // The drivers deliver, and the tickets go on as they come in.
    const deliveries = new DeliveryService(context);
    let serial = 900_000;
    let deliveredGallons = 0;
    for (const route of context.routes.list({ runOn })) {
      for (const stop of route.stops) {
        const tank = context.tanks.get(stop.tankId);
        const gauge = forecasting.estimatedGauge(stop.tankId, { asOf: runOn });
        const room = ((tank.geometry.fillLimit - gauge) / 100) * tank.waterCapacity;
        const drop = Math.min(stop.plannedGallons, Math.floor(room));
        serial += 1;
        const posted = deliveries.post({
          id: context.ids.next('dlv'),
          ticketNumber: ticketNumber(serial),
          customerId: stop.customerId,
          tankId: stop.tankId,
          deliveredOn: runOn,
          gross: drop,
          meterTemperature: 60,
          gaugeBefore: Math.round(gauge),
          gaugeAfter: tank.geometry.fillLimit,
          driverId: route.driverId as string,
          truckId: route.truckId,
        });
        deliveredGallons += posted.delivery.net;
        routing.recordDelivery(route.id, stop.tankId, posted.delivery.id);
      }
    }
    expect(deliveredGallons).toBeGreaterThan(0);

    // Nothing is left pending, so the routes close.
    for (const route of context.routes.list({ runOn })) {
      expect(routing.close(route.id).status).toBe('closed');
    }
    expect(context.routes.outstandingStops(runOn)).toEqual([]);

    // The shifts close and the day reconciles.
    const reconciliation = new ReconciliationService(context);
    for (const load of context.loads.list({ openOnly: true })) {
      const ticketed = context.deliveries
        .list({ truckId: load.truckId, from: runOn, to: runOn, postedOnly: true })
        .reduce((total, ticket) => total + ticket.gross, 0);
      context.loads.closeShift(load.id, load.meterStart + ticketed);
    }
    for (const shift of reconciliation.forDay(runOn)) {
      expect(shift.meteredVsTicketed).toBe(0);
      expect(['clean', 'meter_drift']).toContain(shift.verdict);
    }

    // And the day shows up in the reports.
    const reports = new ReportService(context);
    const efficiency = reports.routeEfficiency(runOn, runOn);
    expect(efficiency.routes).toBe(routes.length);
    expect(efficiency.missedStops).toBe(0);
    expect(efficiency.deliveredGallons).toBeGreaterThan(0);
    expect(efficiency.fillRate).toBeGreaterThan(0.5);
  });

  it('leaves a tank alone once it has just been filled', () => {
    const { context } = buildYard();
    const dispatch = new DispatchService(context, YARD);
    const first = dispatch.plan({ asOf: TODAY, windowDays: 21 });
    const firstStops = new Set(
      first.plan.routes.flatMap((route) => route.stops.map((s) => s.tankId)),
    );
    expect(firstStops.size).toBeGreaterThan(0);

    const deliveries = new DeliveryService(context);
    let serial = 950_000;
    for (const tankId of firstStops) {
      const tank = context.tanks.get(tankId);
      serial += 1;
      deliveries.post({
        id: context.ids.next('dlv'),
        ticketNumber: ticketNumber(serial),
        customerId: tank.customerId,
        tankId,
        deliveredOn: TODAY,
        gross: 10,
        meterTemperature: 60,
        gaugeBefore: tank.geometry.fillLimit - 2,
        gaugeAfter: tank.geometry.fillLimit,
        driverId: 'drv-1',
        truckId: 'trk-b4',
      });
    }

    const second = dispatch.plan({ asOf: TODAY, windowDays: 21 });
    const secondStops = new Set(
      second.plan.routes.flatMap((route) => route.stops.map((s) => s.tankId)),
    );
    for (const tankId of firstStops) {
      expect(secondStops.has(tankId)).toBe(false);
    }
  });

  it('refuses to overfill a tank the projection was wrong about', () => {
    const { context } = buildYard();
    const deliveries = new DeliveryService(context);
    const tank = context.tanks.list()[0];
    expect(() =>
      deliveries.post({
        id: 'dlv-bad',
        ticketNumber: ticketNumber(999_001),
        customerId: (tank as { customerId: string }).customerId,
        tankId: (tank as { id: string }).id,
        deliveredOn: TODAY,
        gross: 5000,
        meterTemperature: 60,
        gaugeBefore: 70,
        gaugeAfter: 80,
        driverId: 'drv-1',
        truckId: 'trk-b4',
      }),
    ).toThrowError(/passes the filling limit/);
    expect(context.deliveries.find('dlv-bad')).toBeUndefined();
  });
});
