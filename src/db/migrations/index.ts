import { Migration } from '../migrate';
import { migration as accountsAndTanks } from './0001-accounts-and-tanks';
import { migration as deliveriesAndReadings } from './0003-deliveries-and-readings';
import { migration as weather } from './0002-weather';

/** Every migration, in the order they were written. */
export const MIGRATIONS: readonly Migration[] = [accountsAndTanks, weather, deliveriesAndReadings];
