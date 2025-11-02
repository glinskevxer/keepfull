import { Migration } from '../migrate';
import { migration as accountsAndTanks } from './0001-accounts-and-tanks';
import { migration as deliveriesAndReadings } from './0003-deliveries-and-readings';
import { migration as fleet } from './0004-fleet';
import { migration as pricing } from './0006-pricing';
import { migration as routes } from './0005-routes';
import { migration as weather } from './0002-weather';

/** Every migration, in the order they were written. */
export const MIGRATIONS: readonly Migration[] = [
  accountsAndTanks,
  weather,
  deliveriesAndReadings,
  fleet,
  routes,
  pricing,
];
