import { ConflictError, NotFoundError } from '../../core/errors';
import { Customer, DeliveryMode, RateClass, makeCustomer } from '../../model/customer';
import { DayKey } from '../../util/dates';
import { Db } from '../connection';
import { WhereClause, limitOf } from '../query';

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

export interface CustomerSearchHit {
  readonly customer: Customer;
  /** Which field the search matched on, for the screen to show. */
  readonly matchedOn: 'account' | 'name' | 'address' | 'tank';
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
    const where = new WhereClause()
      .eq('delivery_mode', 'deliveryMode', query.deliveryMode)
      .eq('rate_class', 'rateClass', query.rateClass)
      .eq('station_id', 'stationId', query.stationId)
      .eq('town', 'town', query.town)
      .when(query.openOnly, 'closed_on IS NULL');
    return this.db
      .prepare<Record<string, unknown>, CustomerRow>(
        `SELECT * FROM customers ${where.sql} ORDER BY account_number LIMIT @limit OFFSET @offset`,
      )
      .all(where.bind({ limit: limitOf(query.limit), offset: query.offset ?? 0 }))
      .map(rowToCustomer);
  }

  count(query: CustomerQuery = {}): number {
    const where = new WhereClause()
      .eq('delivery_mode', 'deliveryMode', query.deliveryMode)
      .eq('rate_class', 'rateClass', query.rateClass)
      .eq('station_id', 'stationId', query.stationId)
      .eq('town', 'town', query.town)
      .when(query.openOnly, 'closed_on IS NULL');
    const row = this.db
      .prepare<
        Record<string, unknown>,
        { n: number }
      >(`SELECT count(*) AS n FROM customers ${where.sql}`)
      .get(where.bind());
    return row?.n ?? 0;
  }

  /**
   * The search box. One field, because the office types whatever they have:
   * part of a name, an account number with or without its dash, a road, or the
   * serial off the tank in front of them. Ordered so an exact account number
   * comes first, since that is the one case where the person already knows
   * exactly which account they want.
   */
  search(term: string, limit = 25): CustomerSearchHit[] {
    // The wildcards go before the length check, not after. Searching for `%%`
    // otherwise cleaned down to nothing and then matched the entire book.
    const trimmed = term.trim().replace(/[%_]/g, '');
    if (trimmed.length < 2) {
      return [];
    }
    const like = `%${trimmed}%`;
    const digits = trimmed.replace(/\D/g, '');
    const account = digits.length >= 6 ? `%${digits.slice(0, 2)}-${digits.slice(2)}%` : like;
    const rows = this.db
      .prepare<Record<string, unknown>, CustomerRow & { matched_on: string }>(
        `SELECT c.*, CASE
             WHEN c.account_number LIKE @account THEN 'account'
             WHEN c.billing_name LIKE @like OR c.service_name LIKE @like THEN 'name'
             WHEN c.address_line1 LIKE @like OR c.town LIKE @like THEN 'address'
             ELSE 'tank'
           END AS matched_on
           FROM customers c
          WHERE c.account_number LIKE @account
             OR c.billing_name LIKE @like
             OR c.service_name LIKE @like
             OR c.address_line1 LIKE @like
             OR c.town LIKE @like
             OR EXISTS (SELECT 1 FROM tanks t WHERE t.customer_id = c.id AND t.serial_number LIKE @like)
          ORDER BY CASE
             WHEN c.account_number LIKE @account THEN 0
             WHEN c.billing_name LIKE @like OR c.service_name LIKE @like THEN 1
             ELSE 2
           END, c.account_number
          LIMIT @limit`,
      )
      .all({ like, account, limit });
    return rows.map((row) => ({
      customer: rowToCustomer(row),
      matchedOn: row.matched_on as CustomerSearchHit['matchedOn'],
    }));
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
