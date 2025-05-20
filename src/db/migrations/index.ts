import { Migration } from '../migrate';
import { migration as accountsAndTanks } from './0001-accounts-and-tanks';

/** Every migration, in the order they were written. */
export const MIGRATIONS: readonly Migration[] = [accountsAndTanks];
