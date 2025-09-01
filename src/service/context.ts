import { CustomerRepository } from '../db/repo/customer-repo';
import { DayKey, today } from '../util/dates';
import { Db } from '../db/connection';
import { DeliveryRepository } from '../db/repo/delivery-repo';
import { FleetRepository } from '../db/repo/fleet-repo';
import { IdFactory } from '../util/ids';
import { Logger } from '../util/logger';
import { ReadingRepository } from '../db/repo/reading-repo';
import { TankRepository } from '../db/repo/tank-repo';
import { WeatherRepository } from '../db/repo/weather-repo';

/**
 * One bag of collaborators, built once at start up and handed to every service.
 *
 * The clock is in here rather than being read from `Date.now` inside the
 * forecasting code, because half the interesting behaviour in this system is
 * "what does it decide on a Tuesday in January", and that is not testable
 * against the real clock.
 */
export interface AppContext {
  readonly db: Db;
  readonly customers: CustomerRepository;
  readonly tanks: TankRepository;
  readonly deliveries: DeliveryRepository;
  readonly fleet: FleetRepository;
  readonly readings: ReadingRepository;
  readonly weather: WeatherRepository;
  readonly logger: Logger;
  readonly ids: IdFactory;
  readonly clock: () => Date;
}

export interface ContextOptions {
  readonly logger?: Logger;
  readonly ids?: IdFactory;
  readonly clock?: () => Date;
}

export function buildContext(db: Db, options: ContextOptions = {}): AppContext {
  return {
    db,
    customers: new CustomerRepository(db),
    tanks: new TankRepository(db),
    deliveries: new DeliveryRepository(db),
    fleet: new FleetRepository(db),
    readings: new ReadingRepository(db),
    weather: new WeatherRepository(db),
    logger: options.logger ?? new Logger(),
    ids: options.ids ?? new IdFactory(),
    clock: options.clock ?? (() => new Date()),
  };
}

export function currentDay(context: AppContext): DayKey {
  return today(context.clock());
}
