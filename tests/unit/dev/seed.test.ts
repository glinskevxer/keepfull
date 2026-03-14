import { afterEach, describe, expect, it } from 'vitest';
import { Rng, meanTemperatureOn, seed } from '../../../src/dev/seed';
import { buildContext } from '../../../src/service/context';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { Logger, MemorySink } from '../../../src/util/logger';

afterEach(closeTestDatabases);

function context() {
  return buildContext(testDatabase(), {
    logger: new Logger({ sink: new MemorySink(), level: 'error' }),
    clock: () => new Date('2026-03-31T06:00:00Z'),
  });
}

const small = { customers: 4, from: dayKey('2025-01-01'), to: dayKey('2025-12-31') };

describe('Rng', () => {
  it('repeats for the same seed', () => {
    const first = new Rng(7);
    const second = new Rng(7);
    expect([first.next(), first.next()]).toEqual([second.next(), second.next()]);
  });

  it('differs for a different seed', () => {
    expect(new Rng(7).next()).not.toBe(new Rng(8).next());
  });

  it('stays inside its range', () => {
    const rng = new Rng(3);
    for (let index = 0; index < 200; index += 1) {
      const value = rng.between(10, 20);
      expect(value).toBeGreaterThanOrEqual(10);
      expect(value).toBeLessThanOrEqual(20);
    }
  });

  it('produces whole numbers inside a closed range', () => {
    const rng = new Rng(11);
    const seen = new Set<number>();
    for (let index = 0; index < 500; index += 1) {
      seen.add(rng.intBetween(1, 3));
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('picks from a list and refuses an empty one', () => {
    const rng = new Rng(5);
    expect(['a', 'b']).toContain(rng.pick(['a', 'b']));
    expect(() => rng.pick([])).toThrowError(/empty list/);
  });
});

describe('meanTemperatureOn', () => {
  it('is colder in january than in july', () => {
    const january = meanTemperatureOn(dayKey('2025-01-15'), new Rng(1));
    const july = meanTemperatureOn(dayKey('2025-07-15'), new Rng(1));
    expect(january).toBeLessThan(july);
  });
});

describe('seed', () => {
  it('builds a yard', () => {
    const app = context();
    const summary = seed(app, small);
    expect(summary.customers).toBe(4);
    expect(summary.tanks).toBe(4);
    expect(summary.stations).toBe(2);
    expect(summary.deliveries).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const first = seed(context(), small);
    const second = seed(context(), small);
    expect(second).toEqual(first);
  });

  it('changes with the seed', () => {
    const first = seed(context(), small);
    const second = seed(context(), { ...small, seed: 999 });
    expect(second.deliveries).not.toBe(first.deliveries);
  });

  it('leaves every tank with a fillable history', () => {
    const app = context();
    seed(app, small);
    for (const tank of app.tanks.list()) {
      const history = app.deliveries.historyForTank(tank.id);
      expect(history.length).toBeGreaterThan(2);
      expect(history.every((delivery) => delivery.gaugeAfter === 80)).toBe(true);
    }
  });

  it('gives every account a station that exists', () => {
    const app = context();
    seed(app, small);
    for (const customer of app.customers.list()) {
      expect(app.weather.findStation(customer.stationId)).toBeDefined();
    }
  });

  it('records weather for every day in the range', () => {
    const app = context();
    seed(app, small);
    expect(app.weather.countObservations('KITH')).toBe(365);
    expect(app.weather.latestObservationDay('KITH')).toBe('2025-12-31');
  });

  it('leaves the normals in place for a forecast to walk forward', () => {
    const app = context();
    seed(app, small);
    expect(app.weather.loadNormals('KITH').size).toBeGreaterThan(300);
  });
});
