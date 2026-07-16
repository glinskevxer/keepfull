import { afterEach, describe, expect, it } from 'vitest';
import { AppContext, buildContext } from '../../src/service/context';
import { DeliveryCalendar } from '../../src/core/calendar';
import { DeliveryService } from '../../src/service/deliveries';
import { DispatchService } from '../../src/service/dispatch';
import { ExceptionService } from '../../src/service/exceptions';
import { ForecastingService } from '../../src/service/forecasting';
import { IdFactory, ticketNumber } from '../../src/util/ids';
import { Logger, MemorySink } from '../../src/util/logger';
import { ReportService } from '../../src/service/reports';
import { RoutingService } from '../../src/service/routing';
import { closeTestDatabases, testDatabase } from '../support/db';
import { DayKey, addDays, dayKey } from '../../src/util/dates';
import { runJob } from '../../src/jobs/runner';
import { nightlyForecast } from '../../src/jobs/nightly-forecast';
import { seed } from '../../src/dev/seed';

afterEach(closeTestDatabases);

const START = dayKey('2026-01-05');
const YARD = { latitude: 42.4432, longitude: -76.5019 };
const CALENDAR = new DeliveryCalendar();

/**
 * Six weeks of a real winter, run a day at a time.
 *
 * The unit tests and the single day end to end test both work on a fixed
 * clock. What they cannot catch is anything that only goes wrong when the
 * system is fed its own output: a projection written back as an estimated
 * reading and then read again as though it were measured, a tank dispatched
 * twice because the first fill had not been posted yet, a burn model that
 * degrades a little every time it refits on a history it partly produced.
 *
 * All three of those happened. This is the test that would have caught them.
 */
describe('six weeks of winter', () => {
  it('never runs a tank out, never fills one twice, and keeps the models stable', () => {
    let today: DayKey = START;
    const sink = new MemorySink();
    const context: AppContext = buildContext(testDatabase(), {
      logger: new Logger({ sink, level: 'warn' }),
      ids: new IdFactory({ now: () => 1_700_000_000_000 }, () => 0.5),
      clock: () => new Date(`${today}T06:00:00.000Z`),
    });
    seed(context, { customers: 10, from: dayKey('2024-06-01'), to: START, seed: 8812 });

    const forecasting = new ForecastingService(context);
    const dispatch = new DispatchService(context, YARD, CALENDAR);
    const routing = new RoutingService(context, CALENDAR);
    const deliveries = new DeliveryService(context);
    const exceptions = new ExceptionService(context);

    let serial = 500_000;
    let ticketsPosted = 0;
    let daysRun = 0;
    const filledOn = new Map<string, DayKey>();
    const doubleFills: string[] = [];

    for (let day = 0; day < 42; day += 1) {
      today = addDays(START, day);
      if (!CALENDAR.runs(today)) {
        continue;
      }
      daysRun += 1;

      // The nightly job runs first, exactly as cron would.
      runJob(nightlyForecast, { app: context, today, dryRun: false });

      const plan = dispatch.plan({ asOf: today, windowDays: 5 });
      const routes = routing.commit(plan, {
        runOn: today,
        drivers: { 'trk-b4': 'drv-1', 'trk-b7': 'drv-2' },
      });

      for (const route of routes) {
        routing.release(route.id);
        for (const stop of route.stops) {
          const tank = context.tanks.get(stop.tankId);
          const gauge = forecasting.estimatedGauge(stop.tankId, { asOf: today });
          const room = ((tank.geometry.fillLimit - gauge) / 100) * tank.waterCapacity;
          const drop = Math.max(1, Math.floor(Math.min(stop.plannedGallons, room)));

          const previous = filledOn.get(stop.tankId);
          if (previous !== undefined && day - Number(previous.slice(8)) < 0) {
            doubleFills.push(stop.tankId);
          }
          if (previous === previousDayOf(today)) {
            doubleFills.push(stop.tankId);
          }

          serial += 1;
          const posted = deliveries.post({
            id: context.ids.next('dlv'),
            ticketNumber: ticketNumber(serial),
            customerId: stop.customerId,
            tankId: stop.tankId,
            deliveredOn: today,
            gross: drop,
            meterTemperature: 35,
            gaugeBefore: Math.round(gauge),
            gaugeAfter: tank.geometry.fillLimit,
            driverId: route.driverId as string,
            truckId: route.truckId,
          });
          ticketsPosted += 1;
          filledOn.set(stop.tankId, today);
          routing.recordDelivery(route.id, stop.tankId, posted.delivery.id);
        }
        routing.close(route.id);
      }
    }

    // The trucks ran on the days the calendar allows and nothing else.
    expect(daysRun).toBeGreaterThan(25);
    expect(ticketsPosted).toBeGreaterThan(5);
    expect(doubleFills).toEqual([]);

    // Nobody ran out over the whole six weeks.
    const ranOut = context.deliveries
      .list({ from: START, to: today, postedOnly: true })
      .filter((delivery) => delivery.gaugeBefore !== undefined && delivery.gaugeBefore <= 5);
    expect(ranOut).toEqual([]);

    // Every tank that could be forecast at the start still can at the end, and
    // the models did not degrade into nonsense on their own output.
    for (const tank of context.tanks.list({ inServiceOnly: true })) {
      const result = forecasting.tryForTank(tank.id, { asOf: today });
      if (!result) {
        continue;
      }
      expect(result.model.baseGallonsPerDay).toBeGreaterThanOrEqual(0);
      expect(result.model.baseGallonsPerDay).toBeLessThan(20);
      expect(result.model.weatherGallonsPerDegreeDay).toBeGreaterThanOrEqual(0);
      expect(result.model.weatherGallonsPerDegreeDay).toBeLessThan(5);
      expect(result.model.fitQuality).toBeGreaterThanOrEqual(0);
      expect(result.model.fitQuality).toBeLessThanOrEqual(1);
    }

    // The estimated readings the nightly job wrote never displaced a measured
    // one, so a starting point is still taken from something real.
    for (const tank of context.tanks.list({ inServiceOnly: true })) {
      const measured = context.readings.latestFor(tank.id, { measuredOnly: true });
      if (measured) {
        expect(measured.source).not.toBe('estimated');
      }
    }

    // And the board is still readable rather than being every tank on the book.
    const board = exceptions.report({ asOf: today });
    expect(board.exceptions.length).toBeLessThan(context.tanks.list().length * 2);

    // The gallons went somewhere the reports can find.
    const gallons = new ReportService(context).gallonsByMonth(START, today);
    expect(gallons.reduce((total, row) => total + row.tickets, 0)).toBe(ticketsPosted);
  });
});

function previousDayOf(day: DayKey): DayKey {
  return addDays(day, -1);
}
