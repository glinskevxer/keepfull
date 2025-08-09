import { AppContext, buildContext } from '../../src/service/context';
import { Customer } from '../../src/model/customer';
import { DayKey, addDays, dayKey, dayRange } from '../../src/util/dates';
import { IdFactory } from '../../src/util/ids';
import { Logger, MemorySink } from '../../src/util/logger';
import { Station, makeStation } from '../../src/model/station';
import { Tank } from '../../src/model/tank';
import { aCustomer, aDelivery, aTank } from './fixtures';
import { fahrenheit } from '../../src/core/units';
import { testDatabase } from './db';

/**
 * Builds a yard with one account, one tank and as much weather and ticket
 * history as a test asks for. The weather is deliberately flat, twenty degree
 * days a day, so the expected gallons in a test are arithmetic rather than a
 * number copied out of a previous run.
 */

export interface ScenarioOptions {
  readonly today?: string;
  readonly degreeDaysPerDay?: number;
  readonly weatherFrom?: string;
  readonly weatherTo?: string;
  readonly waterCapacity?: number;
  readonly reservePercent?: number;
}

export interface Scenario {
  readonly context: AppContext;
  readonly sink: MemorySink;
  readonly station: Station;
  readonly customer: Customer;
  readonly tank: Tank;
  readonly today: DayKey;
  fill(on: string, gallons: number, overrides?: Record<string, unknown>): void;
  read(on: string, gauge: number, source?: 'monitor' | 'driver' | 'customer'): void;
}

export function buildScenario(options: ScenarioOptions = {}): Scenario {
  const todayKey = dayKey(options.today ?? '2025-02-01');
  const sink = new MemorySink();
  const context = buildContext(testDatabase(), {
    logger: new Logger({ sink, level: 'debug' }),
    ids: new IdFactory({ now: () => 1_700_000_000_000 }, () => 0.5),
    clock: () => new Date(`${todayKey}T09:00:00.000Z`),
  });

  const station = makeStation({
    id: 'KITH',
    name: 'Ithaca Tompkins Regional',
    latitude: 42.4908,
    longitude: -76.4584,
    elevationFeet: 1099,
  });
  context.weather.saveStation(station);

  // Twenty degree days a day: a mean of forty five against a sixty five base.
  const perDay = options.degreeDaysPerDay ?? 20;
  const high = 55;
  const low = high - 2 * (high - (65 - perDay));
  const from = dayKey(options.weatherFrom ?? '2023-01-01');
  const to = dayKey(options.weatherTo ?? addDays(todayKey, 1));
  const recordedAt = new Date(`${todayKey}T06:00:00.000Z`);
  for (const day of dayRange(from, to)) {
    context.weather.recordObservation(
      station.id,
      { day, high: fahrenheit(high), low: fahrenheit(low) },
      recordedAt,
    );
  }
  for (let month = 1; month <= 12; month += 1) {
    for (let day = 1; day <= 31; day += 1) {
      context.weather.saveNormal(
        station.id,
        `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        perDay,
      );
    }
  }

  const customer = aCustomer({ stationId: station.id });
  context.customers.insert(customer);
  const tank = aTank(customer.id, {
    waterCapacity: options.waterCapacity ?? 500,
    ...(options.reservePercent === undefined ? {} : { reservePercent: options.reservePercent }),
  });
  context.tanks.insert(tank);

  return {
    context,
    sink,
    station,
    customer,
    tank,
    today: todayKey,
    fill(on, gallons, overrides = {}) {
      context.deliveries.insert(
        aDelivery(customer.id, tank.id, {
          deliveredOn: on,
          gross: gallons,
          meterTemperature: 60,
          gaugeAfter: 80,
          gaugeBefore: 20,
          ...overrides,
        }),
      );
    },
    read(on, gauge, source = 'driver') {
      context.readings.record({
        id: context.ids.next('r'),
        tankId: tank.id,
        takenOn: dayKey(on),
        gauge: gauge as never,
        source,
        ...(source === 'monitor' ? { monitorId: 'WT-1' } : {}),
      });
    },
  };
}
