import { ConflictError, NotFoundError } from '../../core/errors';
import { DayKey, dayKey } from '../../util/dates';
import { Db } from '../connection';
import { WhereClause, limitOf } from '../query';
import { Percent } from '../../core/units';
import { ReadingSource, TankReading, bestReading } from '../../model/reading';

interface ReadingRow {
  id: string;
  tank_id: string;
  taken_on: string;
  gauge: number;
  source: string;
  monitor_id: string | null;
  note: string | null;
}

export function rowToReading(row: ReadingRow): TankReading {
  return {
    id: row.id,
    tankId: row.tank_id,
    takenOn: dayKey(row.taken_on),
    gauge: row.gauge as Percent,
    source: row.source as ReadingSource,
    ...(row.monitor_id ? { monitorId: row.monitor_id } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}

export interface ReadingQuery {
  readonly tankId?: string;
  readonly source?: ReadingSource;
  readonly from?: DayKey;
  readonly to?: DayKey;
  readonly measuredOnly?: boolean;
  readonly limit?: number;
}

/**
 * Gauge readings.
 *
 * The unique index on tank, day and source means a monitor that reports six
 * times a day collapses to one row, the last one in. That is deliberate: the
 * forecast works in whole days and keeping every telemetry ping would grow this
 * table past everything else in the database put together for no gain.
 */
export class ReadingRepository {
  constructor(private readonly db: Db) {}

  /** Writes a reading, replacing any earlier one for the same tank, day and source. */
  record(reading: TankReading): void {
    this.db
      .prepare(
        `INSERT INTO tank_readings (id, tank_id, taken_on, gauge, source, monitor_id, note)
         VALUES (@id, @tankId, @takenOn, @gauge, @source, @monitorId, @note)
         ON CONFLICT (tank_id, taken_on, source) DO UPDATE SET
           id = excluded.id,
           gauge = excluded.gauge,
           monitor_id = excluded.monitor_id,
           note = excluded.note`,
      )
      .run({
        id: reading.id,
        tankId: reading.tankId,
        takenOn: reading.takenOn,
        gauge: reading.gauge,
        source: reading.source,
        monitorId: reading.monitorId ?? null,
        note: reading.note ?? null,
      });
  }

  recordMany(readings: readonly TankReading[]): number {
    const write = this.db.transaction((batch: readonly TankReading[]) => {
      for (const reading of batch) {
        this.record(reading);
      }
    });
    write(readings);
    return readings.length;
  }

  find(id: string): TankReading | undefined {
    const row = this.db
      .prepare<[string], ReadingRow>('SELECT * FROM tank_readings WHERE id = ?')
      .get(id);
    return row ? rowToReading(row) : undefined;
  }

  get(id: string): TankReading {
    const reading = this.find(id);
    if (!reading) {
      throw new NotFoundError('reading', id);
    }
    return reading;
  }

  list(query: ReadingQuery = {}): TankReading[] {
    const where = new WhereClause()
      .eq('tank_id', 'tankId', query.tankId)
      .eq('source', 'source', query.source)
      .gte('taken_on', 'from', query.from)
      .lte('taken_on', 'to', query.to)
      .when(query.measuredOnly, "source <> 'estimated'");
    return this.db
      .prepare<Record<string, unknown>, ReadingRow>(
        `SELECT * FROM tank_readings ${where.sql} ORDER BY taken_on DESC, source LIMIT @limit`,
      )
      .all(where.bind({ limit: limitOf(query.limit) }))
      .map(rowToReading);
  }

  /** The reading dispatch should act on for a tank, best source on the latest day. */
  latestFor(
    tankId: string,
    options: { measuredOnly?: boolean; asOf?: DayKey } = {},
  ): TankReading | undefined {
    const rows = this.list({
      tankId,
      ...(options.measuredOnly ? { measuredOnly: true } : {}),
      ...(options.asOf ? { to: options.asOf } : {}),
      limit: 8,
    });
    if (rows.length === 0) {
      return undefined;
    }
    const latestDay = rows[0]?.takenOn as DayKey;
    return bestReading(rows.filter((row) => row.takenOn === latestDay));
  }

  /** Deletes the estimates for a tank, which the nightly run does before rewriting them. */
  clearEstimates(tankId: string): number {
    return this.db
      .prepare("DELETE FROM tank_readings WHERE tank_id = ? AND source = 'estimated'")
      .run(tankId).changes;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM tank_readings WHERE id = ?').run(id).changes > 0;
  }

  /** Drops measured readings older than a day, keeping the database from growing forever. */
  purgeBefore(day: DayKey): number {
    if (!day) {
      throw new ConflictError('a purge needs a cutoff day');
    }
    return this.db.prepare('DELETE FROM tank_readings WHERE taken_on < ?').run(day).changes;
  }

  count(query: ReadingQuery = {}): number {
    return this.list({ ...query, limit: -1 }).length;
  }
}
