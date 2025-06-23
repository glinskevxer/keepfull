import { DailyTemperature, DegreeDayLedger, NormalYear } from '../../core/degree-days';
import { DayKey, dayKey } from '../../util/dates';
import { Db } from '../connection';
import { NotFoundError } from '../../core/errors';
import { Station, makeStation } from '../../model/station';
import { fahrenheit } from '../../core/units';

interface StationRow {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation_feet: number;
  base_temperature: number;
  active: number;
}

interface ObservationRow {
  day: string;
  high_f: number;
  low_f: number;
}

function toStation(row: StationRow): Station {
  return makeStation({
    id: row.id,
    name: row.name,
    latitude: row.latitude,
    longitude: row.longitude,
    elevationFeet: row.elevation_feet,
    baseTemperature: row.base_temperature,
    active: row.active === 1,
  });
}

/**
 * Everything that reads or writes weather. The ledger and the normals objects
 * the forecast wants are built here rather than in the service layer, because
 * assembling them is a query shape and not a decision.
 */
export class WeatherRepository {
  constructor(private readonly db: Db) {}

  saveStation(station: Station): void {
    this.db
      .prepare(
        `INSERT INTO stations (id, name, latitude, longitude, elevation_feet, base_temperature, active)
         VALUES (@id, @name, @latitude, @longitude, @elevationFeet, @baseTemperature, @active)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name,
           latitude = excluded.latitude,
           longitude = excluded.longitude,
           elevation_feet = excluded.elevation_feet,
           base_temperature = excluded.base_temperature,
           active = excluded.active`,
      )
      .run({
        id: station.id,
        name: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        elevationFeet: station.elevationFeet,
        baseTemperature: station.baseTemperature,
        active: station.active ? 1 : 0,
      });
  }

  findStation(id: string): Station | undefined {
    const row = this.db
      .prepare<[string], StationRow>('SELECT * FROM stations WHERE id = ?')
      .get(id);
    return row ? toStation(row) : undefined;
  }

  getStation(id: string): Station {
    const station = this.findStation(id);
    if (!station) {
      throw new NotFoundError('station', id);
    }
    return station;
  }

  listStations(options: { activeOnly?: boolean } = {}): Station[] {
    const sql = options.activeOnly
      ? 'SELECT * FROM stations WHERE active = 1 ORDER BY id'
      : 'SELECT * FROM stations ORDER BY id';
    return this.db.prepare<[], StationRow>(sql).all().map(toStation);
  }

  recordObservation(stationId: string, reading: DailyTemperature, recordedAt: Date): void {
    this.db
      .prepare(
        `INSERT INTO observations (station_id, day, high_f, low_f, recorded_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (station_id, day) DO UPDATE SET
           high_f = excluded.high_f,
           low_f = excluded.low_f,
           recorded_at = excluded.recorded_at`,
      )
      .run(stationId, reading.day, reading.high, reading.low, recordedAt.toISOString());
  }

  countObservations(stationId: string): number {
    const row = this.db
      .prepare<
        [string],
        { n: number }
      >('SELECT count(*) AS n FROM observations WHERE station_id = ?')
      .get(stationId);
    return row?.n ?? 0;
  }

  latestObservationDay(stationId: string): DayKey | undefined {
    const row = this.db
      .prepare<
        [string],
        { day: string | null }
      >('SELECT max(day) AS day FROM observations WHERE station_id = ?')
      .get(stationId);
    return row?.day ? dayKey(row.day) : undefined;
  }

  /** Builds the in memory ledger the forecast walks, over a closed day range. */
  loadLedger(stationId: string, from: DayKey, to: DayKey): DegreeDayLedger {
    const station = this.getStation(stationId);
    const ledger = new DegreeDayLedger(stationId, station.baseTemperature);
    const rows = this.db
      .prepare<[string, string, string], ObservationRow>(
        `SELECT day, high_f, low_f FROM observations
          WHERE station_id = ? AND day >= ? AND day <= ?
          ORDER BY day`,
      )
      .all(stationId, from, to);
    for (const row of rows) {
      ledger.record({
        day: dayKey(row.day),
        high: fahrenheit(row.high_f),
        low: fahrenheit(row.low_f),
      });
    }
    return ledger;
  }

  saveNormal(stationId: string, monthDay: string, heating: number): void {
    this.db
      .prepare(
        `INSERT INTO degree_day_normals (station_id, month_day, heating)
         VALUES (?, ?, ?)
         ON CONFLICT (station_id, month_day) DO UPDATE SET heating = excluded.heating`,
      )
      .run(stationId, monthDay, heating);
  }

  loadNormals(stationId: string): NormalYear {
    const normals = new NormalYear(stationId);
    const rows = this.db
      .prepare<
        [string],
        { month_day: string; heating: number }
      >('SELECT month_day, heating FROM degree_day_normals WHERE station_id = ? ORDER BY month_day')
      .all(stationId);
    for (const row of rows) {
      normals.set(row.month_day, row.heating);
    }
    return normals;
  }

  deleteStation(id: string): boolean {
    return this.db.prepare('DELETE FROM stations WHERE id = ?').run(id).changes > 0;
  }
}
