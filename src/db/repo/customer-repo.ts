import { ConflictError, NotFoundError } from '../../core/errors';
import { Customer, DeliveryMode, RateClass, makeCustomer } from '../../model/customer';
import { DayKey } from '../../util/dates';
import { Db } from '../connection';

interface CustomerRow {
  id: string;
  account_number: string;
  billing_name: string;
  service_name: string;
  address_line1: string;
  address_line2: string | null;
  town: string;
  county: string;
  postal_code: string;
  latitude: number;
  longitude: number;
  delivery_mode: string;
  rate_class: string;
  station_id: string;
  opened_on: string;
  closed_on: string | null;
  hold_reason: string | null;
}

export function rowToCustomer(row: CustomerRow): Customer {
  return makeCustomer({
    id: row.id,
    accountNumber: row.account_number,
    billingName: row.billing_name,
    serviceName: row.service_name,
    address: {
      line1: row.address_line1,
      ...(row.address_line2 ? { line2: row.address_line2 } : {}),
      town: row.town,
      county: row.county,
      postalCode: row.postal_code,
      latitude: row.latitude,
      longitude: row.longitude,
    },
    deliveryMode: row.delivery_mode as DeliveryMode,
    rateClass: row.rate_class as RateClass,
    stationId: row.station_id,
    openedOn: row.opened_on,
    ...(row.closed_on ? { closedOn: row.closed_on } : {}),
    ...(row.hold_reason ? { holdReason: row.hold_reason } : {}),
  });
}

export interface CustomerQuery {
  readonly deliveryMode?: DeliveryMode;
  readonly rateClass?: RateClass;
  readonly stationId?: string;
  readonly openOnly?: boolean;
  readonly town?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export class CustomerRepository {
  constructor(private readonly db: Db) {}

  insert(customer: Customer): void {
    try {
      this.db
        .prepare(
          `INSERT INTO customers (
             id, account_number, billing_name, service_name, address_line1, address_line2,
             town, county, postal_code, latitude, longitude, delivery_mode, rate_class,
             station_id, opened_on, closed_on, hold_reason)
           VALUES (
             @id, @accountNumber, @billingName, @serviceName, @line1, @line2,
             @town, @county, @postalCode, @latitude, @longitude, @deliveryMode, @rateClass,
             @stationId, @openedOn, @closedOn, @holdReason)`,
        )
        .run(toParams(customer));
    } catch (error) {
      if (String(error).includes('UNIQUE')) {
        throw new ConflictError(`account ${customer.accountNumber} already exists`, {
          accountNumber: customer.accountNumber,
        });
      }
      throw error;
    }
  }

  update(customer: Customer): void {
    const result = this.db
      .prepare(
        `UPDATE customers SET
           account_number = @accountNumber,
           billing_name = @billingName,
           service_name = @serviceName,
           address_line1 = @line1,
           address_line2 = @line2,
           town = @town,
           county = @county,
           postal_code = @postalCode,
           latitude = @latitude,
           longitude = @longitude,
           delivery_mode = @deliveryMode,
           rate_class = @rateClass,
           station_id = @stationId,
           opened_on = @openedOn,
           closed_on = @closedOn,
           hold_reason = @holdReason
         WHERE id = @id`,
      )
      .run(toParams(customer));
    if (result.changes === 0) {
      throw new NotFoundError('customer', customer.id);
    }
  }

  find(id: string): Customer | undefined {
    const row = this.db
      .prepare<[string], CustomerRow>('SELECT * FROM customers WHERE id = ?')
      .get(id);
    return row ? rowToCustomer(row) : undefined;
  }

  get(id: string): Customer {
    const customer = this.find(id);
    if (!customer) {
      throw new NotFoundError('customer', id);
    }
    return customer;
  }

  findByAccountNumber(accountNumber: string): Customer | undefined {
    const row = this.db
      .prepare<[string], CustomerRow>('SELECT * FROM customers WHERE account_number = ?')
      .get(accountNumber);
    return row ? rowToCustomer(row) : undefined;
  }

  list(query: CustomerQuery = {}): Customer[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (query.deliveryMode) {
      clauses.push('delivery_mode = @deliveryMode');
      params.deliveryMode = query.deliveryMode;
    }
    if (query.rateClass) {
      clauses.push('rate_class = @rateClass');
      params.rateClass = query.rateClass;
    }
    if (query.stationId) {
      clauses.push('station_id = @stationId');
      params.stationId = query.stationId;
    }
    if (query.town) {
      clauses.push('town = @town');
      params.town = query.town;
    }
    if (query.openOnly) {
      clauses.push('closed_on IS NULL');
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.limit = query.limit ?? -1;
    params.offset = query.offset ?? 0;
    return this.db
      .prepare<
        Record<string, unknown>,
        CustomerRow
      >(`SELECT * FROM customers ${where} ORDER BY account_number LIMIT @limit OFFSET @offset`)
      .all(params)
      .map(rowToCustomer);
  }

  count(query: CustomerQuery = {}): number {
    return this.list({ ...query, limit: -1, offset: 0 }).length;
  }

  /** Puts an account on hold, or lifts the hold when the reason is empty. */
  setHold(id: string, reason: string | undefined): void {
    const result = this.db
      .prepare('UPDATE customers SET hold_reason = ? WHERE id = ?')
      .run(reason && reason.trim() ? reason : null, id);
    if (result.changes === 0) {
      throw new NotFoundError('customer', id);
    }
  }

  close(id: string, on: DayKey): void {
    const customer = this.get(id);
    if (on < customer.openedOn) {
      throw new ConflictError('an account cannot close before it opened', { id, on });
    }
    this.db.prepare('UPDATE customers SET closed_on = ? WHERE id = ?').run(on, id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM customers WHERE id = ?').run(id).changes > 0;
  }
}

function toParams(customer: Customer): Record<string, string | number | null> {
  return {
    id: customer.id,
    accountNumber: customer.accountNumber,
    billingName: customer.billingName,
    serviceName: customer.serviceName,
    line1: customer.address.line1,
    line2: customer.address.line2 ?? null,
    town: customer.address.town,
    county: customer.address.county,
    postalCode: customer.address.postalCode,
    latitude: customer.address.latitude,
    longitude: customer.address.longitude,
    deliveryMode: customer.deliveryMode,
    rateClass: customer.rateClass,
    stationId: customer.stationId,
    openedOn: customer.openedOn,
    closedOn: customer.closedOn ?? null,
    holdReason: customer.holdReason ?? null,
  };
}
