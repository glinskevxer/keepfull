import { ConflictError, NotFoundError } from '../../core/errors';
import { DayKey, dayKey } from '../../util/dates';
import { Db } from '../connection';
import { Fahrenheit, GrossGallons, NetGallons } from '../../core/units';
import { TruckLoad } from '../../model/truck-load';
import { WhereClause } from '../query';
import { toNetGallons } from '../../core/volume-correction';

interface LoadRow {
  id: string;
  truck_id: string;
  driver_id: string | null;
  loaded_on: string;
  sequence: number;
  plant_gallons: number;
  plant_temperature: number;
  meter_start: number;
  meter_end: number | null;
  note: string | null;
}

/** Rebuilt from the row so a stored load keeps the net it was measured at. */
function toLoad(row: LoadRow, plantNet: number): TruckLoad {
  return {
    id: row.id,
    truckId: row.truck_id,
    ...(row.driver_id ? { driverId: row.driver_id } : {}),
    loadedOn: dayKey(row.loaded_on),
    sequence: row.sequence,
    plantGross: row.plant_gallons as GrossGallons,
    plantTemperature: row.plant_temperature as Fahrenheit,
    plantNet: plantNet as NetGallons,
    meterStart: row.meter_start,
    ...(row.meter_end === null ? {} : { meterEnd: row.meter_end }),
    ...(row.note ? { note: row.note } : {}),
  };
}

export interface LoadQuery {
  readonly truckId?: string;
  readonly driverId?: string;
  readonly from?: DayKey;
  readonly to?: DayKey;
  readonly openOnly?: boolean;
}

export class LoadRepository {
  constructor(private readonly db: Db) {}

  insert(load: TruckLoad): void {
    try {
      this.db
        .prepare(
          `INSERT INTO truck_loads (id, truck_id, driver_id, loaded_on, sequence, plant_gallons,
             plant_temperature, meter_start, meter_end, note)
           VALUES (@id, @truckId, @driverId, @loadedOn, @sequence, @plantGross,
             @plantTemperature, @meterStart, @meterEnd, @note)`,
        )
        .run({
          id: load.id,
          truckId: load.truckId,
          driverId: load.driverId ?? null,
          loadedOn: load.loadedOn,
          sequence: load.sequence,
          plantGross: load.plantGross,
          plantTemperature: load.plantTemperature,
          meterStart: load.meterStart,
          meterEnd: load.meterEnd ?? null,
          note: load.note ?? null,
        });
    } catch (error) {
      if (String(error).includes('UNIQUE')) {
        throw new ConflictError(
          `truck ${load.truckId} already has load ${load.sequence} on ${load.loadedOn}`,
          { truckId: load.truckId, loadedOn: load.loadedOn, sequence: load.sequence },
        );
      }
      throw error;
    }
  }

  /**
   * The plant net is recomputed on read rather than stored, because a plant
   * load is not billed to anybody and nothing downstream has to match a
   * historic correction table.
   */
  private hydrate(row: LoadRow): TruckLoad {
    return toLoad(
      row,
      toNetGallons(row.plant_gallons as GrossGallons, row.plant_temperature as Fahrenheit),
    );
  }

  find(id: string): TruckLoad | undefined {
    const row = this.db
      .prepare<[string], LoadRow>('SELECT * FROM truck_loads WHERE id = ?')
      .get(id);
    return row ? this.hydrate(row) : undefined;
  }

  get(id: string): TruckLoad {
    const load = this.find(id);
    if (!load) {
      throw new NotFoundError('truck load', id);
    }
    return load;
  }

  list(query: LoadQuery = {}): TruckLoad[] {
    const where = new WhereClause()
      .eq('truck_id', 'truckId', query.truckId)
      .eq('driver_id', 'driverId', query.driverId)
      .gte('loaded_on', 'from', query.from)
      .lte('loaded_on', 'to', query.to)
      .when(query.openOnly, 'meter_end IS NULL');
    return this.db
      .prepare<Record<string, unknown>, LoadRow>(
        `SELECT * FROM truck_loads ${where.sql} ORDER BY loaded_on, truck_id, sequence`,
      )
      .all(where.bind())
      .map((row) => this.hydrate(row));
  }

  closeShift(id: string, meterEnd: number): TruckLoad {
    const load = this.get(id);
    if (meterEnd < load.meterStart) {
      throw new ConflictError('a totalising meter cannot run backwards', {
        id,
        meterStart: load.meterStart,
        meterEnd,
      });
    }
    this.db.prepare('UPDATE truck_loads SET meter_end = ? WHERE id = ?').run(meterEnd, id);
    return this.get(id);
  }

  /** The next load number for a truck on a day. */
  nextSequence(truckId: string, on: DayKey): number {
    const row = this.db
      .prepare<
        [string, string],
        { highest: number | null }
      >('SELECT max(sequence) AS highest FROM truck_loads WHERE truck_id = ? AND loaded_on = ?')
      .get(truckId, on);
    return (row?.highest ?? 0) + 1;
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM truck_loads WHERE id = ?').run(id).changes > 0;
  }
}
