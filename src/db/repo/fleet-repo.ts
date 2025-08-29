import { ConflictError, NotFoundError } from '../../core/errors';
import { DayKey } from '../../util/dates';
import { Db } from '../connection';
import {
  Driver,
  LicenceEndorsement,
  Truck,
  TruckKind,
  makeDriver,
  makeTruck,
} from '../../model/fleet';
import { WhereClause } from '../query';

interface TruckRow {
  id: string;
  unit_number: string;
  kind: string;
  water_capacity: number;
  fill_limit: number;
  heel_gallons: number;
  meter_sealed_on: string | null;
  active: number;
}

interface DriverRow {
  id: string;
  name: string;
  licence_number: string;
  endorsements: string;
  medical_card_expires_on: string | null;
  active: number;
}

function toTruck(row: TruckRow): Truck {
  return makeTruck({
    id: row.id,
    unitNumber: row.unit_number,
    kind: row.kind as TruckKind,
    waterCapacity: row.water_capacity,
    fillLimit: row.fill_limit,
    heelGallons: row.heel_gallons,
    ...(row.meter_sealed_on ? { meterSealedOn: row.meter_sealed_on } : {}),
    active: row.active === 1,
  });
}

function toDriver(row: DriverRow): Driver {
  return makeDriver({
    id: row.id,
    name: row.name,
    licenceNumber: row.licence_number,
    endorsements: row.endorsements
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0) as LicenceEndorsement[],
    ...(row.medical_card_expires_on ? { medicalCardExpiresOn: row.medical_card_expires_on } : {}),
    active: row.active === 1,
  });
}

/** Trucks and drivers live together because everything that reads one reads both. */
export class FleetRepository {
  constructor(private readonly db: Db) {}

  saveTruck(truck: Truck): void {
    try {
      this.db
        .prepare(
          `INSERT INTO trucks (id, unit_number, kind, water_capacity, fill_limit, heel_gallons,
             meter_sealed_on, active)
           VALUES (@id, @unitNumber, @kind, @waterCapacity, @fillLimit, @heelGallons,
             @meterSealedOn, @active)
           ON CONFLICT (id) DO UPDATE SET
             unit_number = excluded.unit_number,
             kind = excluded.kind,
             water_capacity = excluded.water_capacity,
             fill_limit = excluded.fill_limit,
             heel_gallons = excluded.heel_gallons,
             meter_sealed_on = excluded.meter_sealed_on,
             active = excluded.active`,
        )
        .run({
          id: truck.id,
          unitNumber: truck.unitNumber,
          kind: truck.kind,
          waterCapacity: truck.waterCapacity,
          fillLimit: truck.fillLimit,
          heelGallons: truck.heelGallons,
          meterSealedOn: truck.meterSealedOn ?? null,
          active: truck.active ? 1 : 0,
        });
    } catch (error) {
      if (String(error).includes('UNIQUE')) {
        throw new ConflictError(`unit ${truck.unitNumber} is already on another truck`, {
          unitNumber: truck.unitNumber,
        });
      }
      throw error;
    }
  }

  findTruck(id: string): Truck | undefined {
    const row = this.db.prepare<[string], TruckRow>('SELECT * FROM trucks WHERE id = ?').get(id);
    return row ? toTruck(row) : undefined;
  }

  getTruck(id: string): Truck {
    const truck = this.findTruck(id);
    if (!truck) {
      throw new NotFoundError('truck', id);
    }
    return truck;
  }

  findTruckByUnit(unitNumber: string): Truck | undefined {
    const row = this.db
      .prepare<[string], TruckRow>('SELECT * FROM trucks WHERE unit_number = ?')
      .get(unitNumber);
    return row ? toTruck(row) : undefined;
  }

  listTrucks(query: { activeOnly?: boolean; kind?: TruckKind } = {}): Truck[] {
    const where = new WhereClause()
      .eq('kind', 'kind', query.kind)
      .when(query.activeOnly, 'active = 1');
    return this.db
      .prepare<
        Record<string, unknown>,
        TruckRow
      >(`SELECT * FROM trucks ${where.sql} ORDER BY unit_number`)
      .all(where.bind())
      .map(toTruck);
  }

  recordMeterSeal(truckId: string, on: DayKey): void {
    const result = this.db
      .prepare('UPDATE trucks SET meter_sealed_on = ? WHERE id = ?')
      .run(on, truckId);
    if (result.changes === 0) {
      throw new NotFoundError('truck', truckId);
    }
  }

  saveDriver(driver: Driver): void {
    try {
      this.db
        .prepare(
          `INSERT INTO drivers (id, name, licence_number, endorsements,
             medical_card_expires_on, active)
           VALUES (@id, @name, @licenceNumber, @endorsements, @medicalCardExpiresOn, @active)
           ON CONFLICT (id) DO UPDATE SET
             name = excluded.name,
             licence_number = excluded.licence_number,
             endorsements = excluded.endorsements,
             medical_card_expires_on = excluded.medical_card_expires_on,
             active = excluded.active`,
        )
        .run({
          id: driver.id,
          name: driver.name,
          licenceNumber: driver.licenceNumber,
          endorsements: driver.endorsements.join(','),
          medicalCardExpiresOn: driver.medicalCardExpiresOn ?? null,
          active: driver.active ? 1 : 0,
        });
    } catch (error) {
      if (String(error).includes('UNIQUE')) {
        throw new ConflictError(`licence ${driver.licenceNumber} is already on file`, {
          licenceNumber: driver.licenceNumber,
        });
      }
      throw error;
    }
  }

  findDriver(id: string): Driver | undefined {
    const row = this.db.prepare<[string], DriverRow>('SELECT * FROM drivers WHERE id = ?').get(id);
    return row ? toDriver(row) : undefined;
  }

  getDriver(id: string): Driver {
    const driver = this.findDriver(id);
    if (!driver) {
      throw new NotFoundError('driver', id);
    }
    return driver;
  }

  listDrivers(query: { activeOnly?: boolean } = {}): Driver[] {
    const where = new WhereClause().when(query.activeOnly, 'active = 1');
    return this.db
      .prepare<
        Record<string, unknown>,
        DriverRow
      >(`SELECT * FROM drivers ${where.sql} ORDER BY name`)
      .all(where.bind())
      .map(toDriver);
  }

  retireTruck(id: string): void {
    const result = this.db.prepare('UPDATE trucks SET active = 0 WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundError('truck', id);
    }
  }

  retireDriver(id: string): void {
    const result = this.db.prepare('UPDATE drivers SET active = 0 WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundError('driver', id);
    }
  }
}
