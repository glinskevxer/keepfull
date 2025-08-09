import { Appliance, Tank, TankOwner, TankSetting, makeTank } from '../../model/tank';
import { ConflictError, NotFoundError } from '../../core/errors';
import { DayKey } from '../../util/dates';
import { Db } from '../connection';
import { WhereClause } from '../query';

interface TankRow {
  id: string;
  customer_id: string;
  serial_number: string;
  water_capacity: number;
  owner: string;
  setting: string;
  fill_limit: number;
  reserve_percent: number;
  appliances: string;
  installed_on: string;
  removed_on: string | null;
  monitor_id: string | null;
  last_leak_check_on: string | null;
  notes: string | null;
}

/**
 * Appliances are stored as a comma separated list in one column rather than in
 * a join table. There are ten of them, they are only ever read as a set, and
 * nothing joins on them.
 */
function encodeAppliances(appliances: readonly Appliance[]): string {
  return appliances.join(',');
}

function decodeAppliances(value: string): Appliance[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0) as Appliance[];
}

export function rowToTank(row: TankRow): Tank {
  return makeTank({
    id: row.id,
    customerId: row.customer_id,
    serialNumber: row.serial_number,
    waterCapacity: row.water_capacity,
    owner: row.owner as TankOwner,
    setting: row.setting as TankSetting,
    fillLimit: row.fill_limit,
    reservePercent: row.reserve_percent,
    appliances: decodeAppliances(row.appliances),
    installedOn: row.installed_on,
    ...(row.removed_on ? { removedOn: row.removed_on } : {}),
    ...(row.monitor_id ? { monitorId: row.monitor_id } : {}),
    ...(row.last_leak_check_on ? { lastLeakCheckOn: row.last_leak_check_on } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
  });
}

export interface TankQuery {
  readonly customerId?: string;
  readonly inServiceOnly?: boolean;
  readonly monitoredOnly?: boolean;
  readonly owner?: TankOwner;
  readonly minimumCapacity?: number;
}

export class TankRepository {
  constructor(private readonly db: Db) {}

  insert(tank: Tank): void {
    try {
      this.db
        .prepare(
          `INSERT INTO tanks (
             id, customer_id, serial_number, water_capacity, owner, setting, fill_limit,
             reserve_percent, appliances, installed_on, removed_on, monitor_id,
             last_leak_check_on, notes)
           VALUES (
             @id, @customerId, @serialNumber, @waterCapacity, @owner, @setting, @fillLimit,
             @reservePercent, @appliances, @installedOn, @removedOn, @monitorId,
             @lastLeakCheckOn, @notes)`,
        )
        .run(toParams(tank));
    } catch (error) {
      const text = String(error);
      if (text.includes('monitor_id') || text.includes('tanks_monitor')) {
        throw new ConflictError(`monitor ${tank.monitorId} is already on another tank`, {
          monitorId: tank.monitorId ?? null,
        });
      }
      if (text.includes('UNIQUE')) {
        throw new ConflictError(`tank serial ${tank.serialNumber} already exists`, {
          serialNumber: tank.serialNumber,
        });
      }
      throw error;
    }
  }

  update(tank: Tank): void {
    const result = this.db
      .prepare(
        `UPDATE tanks SET
           customer_id = @customerId,
           serial_number = @serialNumber,
           water_capacity = @waterCapacity,
           owner = @owner,
           setting = @setting,
           fill_limit = @fillLimit,
           reserve_percent = @reservePercent,
           appliances = @appliances,
           installed_on = @installedOn,
           removed_on = @removedOn,
           monitor_id = @monitorId,
           last_leak_check_on = @lastLeakCheckOn,
           notes = @notes
         WHERE id = @id`,
      )
      .run(toParams(tank));
    if (result.changes === 0) {
      throw new NotFoundError('tank', tank.id);
    }
  }

  find(id: string): Tank | undefined {
    const row = this.db.prepare<[string], TankRow>('SELECT * FROM tanks WHERE id = ?').get(id);
    return row ? rowToTank(row) : undefined;
  }

  get(id: string): Tank {
    const tank = this.find(id);
    if (!tank) {
      throw new NotFoundError('tank', id);
    }
    return tank;
  }

  findBySerial(serialNumber: string): Tank | undefined {
    const row = this.db
      .prepare<[string], TankRow>('SELECT * FROM tanks WHERE serial_number = ?')
      .get(serialNumber);
    return row ? rowToTank(row) : undefined;
  }

  findByMonitor(monitorId: string): Tank | undefined {
    const row = this.db
      .prepare<[string], TankRow>('SELECT * FROM tanks WHERE monitor_id = ?')
      .get(monitorId);
    return row ? rowToTank(row) : undefined;
  }

  list(query: TankQuery = {}): Tank[] {
    const where = new WhereClause()
      .eq('customer_id', 'customerId', query.customerId)
      .eq('owner', 'owner', query.owner)
      .gte('water_capacity', 'minimumCapacity', query.minimumCapacity)
      .when(query.inServiceOnly, 'removed_on IS NULL')
      .when(query.monitoredOnly, 'monitor_id IS NOT NULL');
    return this.db
      .prepare<
        Record<string, unknown>,
        TankRow
      >(`SELECT * FROM tanks ${where.sql} ORDER BY serial_number`)
      .all(where.bind())
      .map(rowToTank);
  }

  /** Moves a tank to another account, which happens when a farm changes hands. */
  reassign(tankId: string, customerId: string): void {
    const result = this.db
      .prepare('UPDATE tanks SET customer_id = ? WHERE id = ?')
      .run(customerId, tankId);
    if (result.changes === 0) {
      throw new NotFoundError('tank', tankId);
    }
  }

  recordLeakCheck(tankId: string, on: DayKey): void {
    const result = this.db
      .prepare('UPDATE tanks SET last_leak_check_on = ? WHERE id = ?')
      .run(on, tankId);
    if (result.changes === 0) {
      throw new NotFoundError('tank', tankId);
    }
  }

  remove(tankId: string, on: DayKey): void {
    const tank = this.get(tankId);
    if (on < tank.installedOn) {
      throw new ConflictError('a tank cannot come out before it went in', { tankId, on });
    }
    this.db
      .prepare('UPDATE tanks SET removed_on = ?, monitor_id = NULL WHERE id = ?')
      .run(on, tankId);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM tanks WHERE id = ?').run(id).changes > 0;
  }
}

function toParams(tank: Tank): Record<string, string | number | null> {
  return {
    id: tank.id,
    customerId: tank.customerId,
    serialNumber: tank.serialNumber,
    waterCapacity: tank.waterCapacity,
    owner: tank.owner,
    setting: tank.setting,
    fillLimit: tank.geometry.fillLimit,
    reservePercent: tank.geometry.reservePercent,
    appliances: encodeAppliances(tank.appliances),
    installedOn: tank.installedOn,
    removedOn: tank.removedOn ?? null,
    monitorId: tank.monitorId ?? null,
    lastLeakCheckOn: tank.lastLeakCheckOn ?? null,
    notes: tank.notes ?? null,
  };
}
