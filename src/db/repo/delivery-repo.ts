import { ConflictError, NotFoundError } from '../../core/errors';
import { DayKey, dayKey } from '../../util/dates';
import { Db } from '../connection';
import { Delivery, DeliveryStatus, FillReason } from '../../model/delivery';
import { Fahrenheit, GrossGallons, NetGallons, Percent } from '../../core/units';

interface DeliveryRow {
  id: string;
  ticket_number: string;
  customer_id: string;
  tank_id: string;
  delivered_on: string;
  gross_gallons: number;
  meter_temperature: number;
  net_gallons: number;
  gauge_before: number | null;
  gauge_after: number | null;
  reason: string;
  status: string;
  driver_id: string;
  truck_id: string;
  notes: string | null;
}

/**
 * Rebuilt straight from the row rather than through `makeDelivery`, because the
 * factory recomputes net gallons off the current correction table and a stored
 * ticket has to keep the number it was billed on.
 */
export function rowToDelivery(row: DeliveryRow): Delivery {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    customerId: row.customer_id,
    tankId: row.tank_id,
    deliveredOn: dayKey(row.delivered_on),
    gross: row.gross_gallons as GrossGallons,
    meterTemperature: row.meter_temperature as Fahrenheit,
    net: row.net_gallons as NetGallons,
    ...(row.gauge_before === null ? {} : { gaugeBefore: row.gauge_before as Percent }),
    ...(row.gauge_after === null ? {} : { gaugeAfter: row.gauge_after as Percent }),
    reason: row.reason as FillReason,
    status: row.status as DeliveryStatus,
    driverId: row.driver_id,
    truckId: row.truck_id,
    ...(row.notes ? { notes: row.notes } : {}),
  };
}

export interface DeliveryQuery {
  readonly tankId?: string;
  readonly customerId?: string;
  readonly truckId?: string;
  readonly driverId?: string;
  readonly from?: DayKey;
  readonly to?: DayKey;
  readonly postedOnly?: boolean;
  readonly limit?: number;
}

export class DeliveryRepository {
  constructor(private readonly db: Db) {}

  insert(delivery: Delivery): void {
    try {
      this.db
        .prepare(
          `INSERT INTO deliveries (
             id, ticket_number, customer_id, tank_id, delivered_on, gross_gallons,
             meter_temperature, net_gallons, gauge_before, gauge_after, reason, status,
             driver_id, truck_id, notes)
           VALUES (
             @id, @ticketNumber, @customerId, @tankId, @deliveredOn, @gross,
             @meterTemperature, @net, @gaugeBefore, @gaugeAfter, @reason, @status,
             @driverId, @truckId, @notes)`,
        )
        .run(toParams(delivery));
    } catch (error) {
      if (String(error).includes('UNIQUE')) {
        throw new ConflictError(`ticket ${delivery.ticketNumber} has already been posted`, {
          ticketNumber: delivery.ticketNumber,
        });
      }
      throw error;
    }
  }

  insertMany(deliveries: readonly Delivery[]): number {
    const write = this.db.transaction((batch: readonly Delivery[]) => {
      for (const delivery of batch) {
        this.insert(delivery);
      }
    });
    write(deliveries);
    return deliveries.length;
  }

  find(id: string): Delivery | undefined {
    const row = this.db
      .prepare<[string], DeliveryRow>('SELECT * FROM deliveries WHERE id = ?')
      .get(id);
    return row ? rowToDelivery(row) : undefined;
  }

  get(id: string): Delivery {
    const delivery = this.find(id);
    if (!delivery) {
      throw new NotFoundError('delivery', id);
    }
    return delivery;
  }

  findByTicketNumber(ticketNumber: string): Delivery | undefined {
    const row = this.db
      .prepare<[string], DeliveryRow>('SELECT * FROM deliveries WHERE ticket_number = ?')
      .get(ticketNumber);
    return row ? rowToDelivery(row) : undefined;
  }

  list(query: DeliveryQuery = {}): Delivery[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (query.tankId) {
      clauses.push('tank_id = @tankId');
      params.tankId = query.tankId;
    }
    if (query.customerId) {
      clauses.push('customer_id = @customerId');
      params.customerId = query.customerId;
    }
    if (query.truckId) {
      clauses.push('truck_id = @truckId');
      params.truckId = query.truckId;
    }
    if (query.driverId) {
      clauses.push('driver_id = @driverId');
      params.driverId = query.driverId;
    }
    if (query.from) {
      clauses.push('delivered_on >= @from');
      params.from = query.from;
    }
    if (query.to) {
      clauses.push('delivered_on <= @to');
      params.to = query.to;
    }
    if (query.postedOnly) {
      clauses.push("status = 'posted'");
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.limit = query.limit ?? -1;
    return this.db
      .prepare<
        Record<string, unknown>,
        DeliveryRow
      >(`SELECT * FROM deliveries ${where} ORDER BY delivered_on, ticket_number LIMIT @limit`)
      .all(params)
      .map(rowToDelivery);
  }

  /** The whole posted history for one tank, oldest first. What the burn model reads. */
  historyForTank(tankId: string): Delivery[] {
    return this.list({ tankId, postedOnly: true });
  }

  lastDeliveryFor(tankId: string): Delivery | undefined {
    const row = this.db
      .prepare<[string], DeliveryRow>(
        `SELECT * FROM deliveries WHERE tank_id = ? AND status = 'posted'
          ORDER BY delivered_on DESC, ticket_number DESC LIMIT 1`,
      )
      .get(tankId);
    return row ? rowToDelivery(row) : undefined;
  }

  void(id: string, note: string): void {
    const result = this.db
      .prepare(
        "UPDATE deliveries SET status = 'void', notes = ? WHERE id = ? AND status = 'posted'",
      )
      .run(note, id);
    if (result.changes === 0) {
      throw new ConflictError(`delivery ${id} is missing or already void`, { id });
    }
  }

  /** Gallons and ticket count over a range, which is what the daily close reads. */
  totals(query: DeliveryQuery = {}): { tickets: number; gross: number; net: number } {
    const rows = this.list({ ...query, postedOnly: true, limit: -1 });
    return {
      tickets: rows.length,
      gross: rows.reduce((total, row) => total + row.gross, 0),
      net: rows.reduce((total, row) => total + row.net, 0),
    };
  }
}

function toParams(delivery: Delivery): Record<string, string | number | null> {
  return {
    id: delivery.id,
    ticketNumber: delivery.ticketNumber,
    customerId: delivery.customerId,
    tankId: delivery.tankId,
    deliveredOn: delivery.deliveredOn,
    gross: delivery.gross,
    meterTemperature: delivery.meterTemperature,
    net: delivery.net,
    gaugeBefore: delivery.gaugeBefore ?? null,
    gaugeAfter: delivery.gaugeAfter ?? null,
    reason: delivery.reason,
    status: delivery.status,
    driverId: delivery.driverId,
    truckId: delivery.truckId,
    notes: delivery.notes ?? null,
  };
}
