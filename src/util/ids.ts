import { assertInteger, assertNonEmpty, assertPositive } from './assert';

/**
 * Identifiers the office recognises.
 *
 * Nothing here is a uuid. The people using this system read these numbers off
 * paper tickets and over the radio, so they are short, they sort in the order
 * they were made, and they carry a check character because "eight eight one"
 * and "eight eight nine" sound the same on a bad connection.
 */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** A monotonic, sortable id: eight characters of time then four of entropy. */
export class IdFactory {
  private lastStamp = 0;
  private counter = 0;

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly random: () => number = Math.random,
  ) {}

  next(prefix = ''): string {
    const stamp = this.clock.now();
    if (stamp === this.lastStamp) {
      this.counter += 1;
    } else {
      this.lastStamp = stamp;
      this.counter = 0;
    }
    const time = encodeBase32(stamp, 8);
    const noise = encodeBase32(Math.floor(this.random() * 32 ** 3) + this.counter, 4);
    return prefix ? `${prefix}_${time}${noise}` : `${time}${noise}`;
  }
}

export function encodeBase32(value: number, width: number): string {
  assertInteger(value, 'value');
  assertPositive(width, 'width');
  let remaining = Math.abs(value);
  let out = '';
  while (remaining > 0) {
    out = (CROCKFORD[remaining % 32] as string) + out;
    remaining = Math.floor(remaining / 32);
  }
  return out.padStart(width, '0').slice(-width);
}

/**
 * Account numbers look like `04-118372`, a two digit branch and a six digit
 * serial. The branch is on the front because the two yards were separate
 * companies until nineteen ninety one and the numbering never merged.
 */
export function accountNumber(branch: number, serial: number): string {
  assertInteger(branch, 'branch');
  assertInteger(serial, 'serial');
  if (branch < 0 || branch > 99) {
    throw new Error(`branch ${branch} is not a two digit branch`);
  }
  if (serial < 0 || serial > 999_999) {
    throw new Error(`serial ${serial} does not fit in six digits`);
  }
  return `${String(branch).padStart(2, '0')}-${String(serial).padStart(6, '0')}`;
}

export function parseAccountNumber(value: string): { branch: number; serial: number } {
  assertNonEmpty(value, 'account number');
  const match = /^(\d{2})-(\d{6})$/.exec(value.trim());
  if (!match) {
    throw new Error(`"${value}" is not an account number`);
  }
  return { branch: Number(match[1]), serial: Number(match[2]) };
}

/** Damm check digit, which catches every single digit slip and every transposition. */
const DAMM_TABLE: readonly (readonly number[])[] = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

export function dammDigit(digits: string): number {
  let interim = 0;
  for (const character of digits) {
    if (character < '0' || character > '9') {
      throw new Error(`"${digits}" has a non digit in it`);
    }
    interim = (DAMM_TABLE[interim] as readonly number[])[Number(character)] as number;
  }
  return interim;
}

/** Ticket numbers are the serial the driver's book prints plus a check digit. */
export function ticketNumber(serial: number): string {
  assertInteger(serial, 'ticket serial');
  assertPositive(serial, 'ticket serial');
  const digits = String(serial).padStart(7, '0');
  return `${digits}${dammDigit(digits)}`;
}

export function isValidTicketNumber(value: string): boolean {
  if (!/^\d{8}$/.test(value)) {
    return false;
  }
  return dammDigit(value) === 0;
}
