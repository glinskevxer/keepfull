import { ConflictError, NotFoundError } from '../../core/errors';
import { DayKey, dayKey } from '../../util/dates';
import { Db, inTransaction } from '../connection';
import { Mills, mills } from '../../util/money';
import { PriceSchedule, makeSchedule } from '../../core/pricing';
import { RateClass } from '../../model/customer';
import { WhereClause } from '../query';

interface ScheduleRow {
  id: string;
  rate_class: string;
  effective_from: string;
  adder_per_gallon: number;
  note: string | null;
}

interface TierRow {
  from_gallons: number;
  price_per_gallon: number;
}

interface LockRow {
  id: string;
  customer_id: string;
  price_per_gallon: number;
  gallons_committed: number;
  gallons_used: number;
  signed_on: string;
  expires_on: string;
}

export interface StoredLock {
  readonly id: string;
  readonly customerId: string;
  readonly pricePerGallon: Mills;
  readonly gallonsCommitted: number;
  readonly gallonsUsed: number;
  readonly signedOn: DayKey;
  readonly expiresOn: DayKey;
}

function toLock(row: LockRow): StoredLock {
  return {
    id: row.id,
    customerId: row.customer_id,
    pricePerGallon: mills(row.price_per_gallon),
    gallonsCommitted: row.gallons_committed,
    gallonsUsed: row.gallons_used,
    signedOn: dayKey(row.signed_on),
    expiresOn: dayKey(row.expires_on),
  };
}

export class PricingRepository {
  constructor(private readonly db: Db) {}

  saveSchedule(schedule: PriceSchedule, note?: string): void {
    inTransaction(this.db, () => {
      try {
        this.db
          .prepare(
            `INSERT INTO price_schedules (id, rate_class, effective_from, adder_per_gallon, note)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET
               rate_class = excluded.rate_class,
               effective_from = excluded.effective_from,
               adder_per_gallon = excluded.adder_per_gallon,
               note = excluded.note`,
          )
          .run(
            schedule.id,
            schedule.rateClass,
            schedule.effectiveFrom,
            schedule.adderPerGallon ?? 0,
            note ?? null,
          );
      } catch (error) {
        if (String(error).includes('UNIQUE')) {
          throw new ConflictError(
            `there is already a ${schedule.rateClass} schedule effective ${schedule.effectiveFrom}`,
            { rateClass: schedule.rateClass, effectiveFrom: schedule.effectiveFrom },
          );
        }
        throw error;
      }
      this.db.prepare('DELETE FROM price_tiers WHERE schedule_id = ?').run(schedule.id);
      const insert = this.db.prepare(
        'INSERT INTO price_tiers (schedule_id, from_gallons, price_per_gallon) VALUES (?, ?, ?)',
      );
      for (const tier of schedule.tiers) {
        insert.run(schedule.id, tier.fromGallons, tier.pricePerGallon);
      }
    });
  }

  private tiersFor(scheduleId: string): TierRow[] {
    return this.db
      .prepare<
        [string],
        TierRow
      >('SELECT from_gallons, price_per_gallon FROM price_tiers WHERE schedule_id = ? ORDER BY from_gallons')
      .all(scheduleId);
  }

  private toSchedule(row: ScheduleRow): PriceSchedule {
    return makeSchedule({
      id: row.id,
      rateClass: row.rate_class as RateClass,
      effectiveFrom: dayKey(row.effective_from),
      ...(row.adder_per_gallon > 0 ? { adderPerGallon: mills(row.adder_per_gallon) } : {}),
      tiers: this.tiersFor(row.id).map((tier) => ({
        fromGallons: tier.from_gallons,
        pricePerGallon: mills(tier.price_per_gallon),
      })),
    });
  }

  findSchedule(id: string): PriceSchedule | undefined {
    const row = this.db
      .prepare<[string], ScheduleRow>('SELECT * FROM price_schedules WHERE id = ?')
      .get(id);
    return row ? this.toSchedule(row) : undefined;
  }

  getSchedule(id: string): PriceSchedule {
    const schedule = this.findSchedule(id);
    if (!schedule) {
      throw new NotFoundError('price schedule', id);
    }
    return schedule;
  }

  listSchedules(query: { rateClass?: RateClass; onOrBefore?: DayKey } = {}): PriceSchedule[] {
    const where = new WhereClause()
      .eq('rate_class', 'rateClass', query.rateClass)
      .lte('effective_from', 'onOrBefore', query.onOrBefore);
    return this.db
      .prepare<Record<string, unknown>, ScheduleRow>(
        `SELECT * FROM price_schedules ${where.sql} ORDER BY rate_class, effective_from DESC`,
      )
      .all(where.bind())
      .map((row) => this.toSchedule(row));
  }

  /** The schedule in force for a class on a day, straight from sql. */
  scheduleInForce(rateClass: RateClass, on: DayKey): PriceSchedule | undefined {
    const row = this.db
      .prepare<[string, string], ScheduleRow>(
        `SELECT * FROM price_schedules
          WHERE rate_class = ? AND effective_from <= ?
          ORDER BY effective_from DESC LIMIT 1`,
      )
      .get(rateClass, on);
    return row ? this.toSchedule(row) : undefined;
  }

  saveLock(lock: StoredLock): void {
    this.db
      .prepare(
        `INSERT INTO price_locks (id, customer_id, price_per_gallon, gallons_committed,
           gallons_used, signed_on, expires_on)
         VALUES (@id, @customerId, @pricePerGallon, @gallonsCommitted, @gallonsUsed,
           @signedOn, @expiresOn)
         ON CONFLICT (id) DO UPDATE SET
           price_per_gallon = excluded.price_per_gallon,
           gallons_committed = excluded.gallons_committed,
           gallons_used = excluded.gallons_used,
           expires_on = excluded.expires_on`,
      )
      .run({
        id: lock.id,
        customerId: lock.customerId,
        pricePerGallon: lock.pricePerGallon,
        gallonsCommitted: lock.gallonsCommitted,
        gallonsUsed: lock.gallonsUsed,
        signedOn: lock.signedOn,
        expiresOn: lock.expiresOn,
      });
  }

  /** The live lock for a customer on a day, if there is one with gallons left. */
  activeLock(customerId: string, on: DayKey): StoredLock | undefined {
    const row = this.db
      .prepare<[string, string], LockRow>(
        `SELECT * FROM price_locks
          WHERE customer_id = ? AND expires_on >= ? AND gallons_used < gallons_committed
          ORDER BY expires_on LIMIT 1`,
      )
      .get(customerId, on);
    return row ? toLock(row) : undefined;
  }

  listLocks(customerId: string): StoredLock[] {
    return this.db
      .prepare<
        [string],
        LockRow
      >('SELECT * FROM price_locks WHERE customer_id = ? ORDER BY signed_on DESC')
      .all(customerId)
      .map(toLock);
  }

  /** Draws gallons off a lock, refusing to draw more than is left. */
  drawLock(lockId: string, gallons: number): StoredLock {
    const row = this.db
      .prepare<[string], LockRow>('SELECT * FROM price_locks WHERE id = ?')
      .get(lockId);
    if (!row) {
      throw new NotFoundError('price lock', lockId);
    }
    const lock = toLock(row);
    const left = lock.gallonsCommitted - lock.gallonsUsed;
    if (gallons > left + 1e-9) {
      throw new ConflictError(`lock ${lockId} has ${left} gallons left, not ${gallons}`, {
        lockId,
        left,
        asked: gallons,
      });
    }
    this.db
      .prepare('UPDATE price_locks SET gallons_used = gallons_used + ? WHERE id = ?')
      .run(gallons, lockId);
    return toLock(
      this.db
        .prepare<[string], LockRow>('SELECT * FROM price_locks WHERE id = ?')
        .get(lockId) as LockRow,
    );
  }
}
