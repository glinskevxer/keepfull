import { ConflictError, NotFoundError } from '../../core/errors';
import { DayKey, dayKey } from '../../util/dates';
import { Db, inTransaction } from '../connection';
import { Route, RouteStatus, RouteStop, StopOutcome, canMoveTo } from '../../model/route';
import { WhereClause } from '../query';

interface RouteRow {
  id: string;
  truck_id: string;
  driver_id: string | null;
  run_on: string;
  status: string;
  planned_gallons: number;
  planned_miles: number;
}

interface StopRow {
  id: string;
  route_id: string;
  tank_id: string;
  customer_id: string;
  position: number;
  planned_gallons: number;
  outcome: string;
  delivery_id: string | null;
  note: string | null;
}

function toStop(row: StopRow): RouteStop {
  return {
    id: row.id,
    routeId: row.route_id,
    tankId: row.tank_id,
    customerId: row.customer_id,
    position: row.position,
    plannedGallons: row.planned_gallons,
    outcome: row.outcome as StopOutcome,
    ...(row.delivery_id ? { deliveryId: row.delivery_id } : {}),
    ...(row.note ? { note: row.note } : {}),
  };
}

function toRoute(row: RouteRow, stops: RouteStop[]): Route {
  return {
    id: row.id,
    truckId: row.truck_id,
    ...(row.driver_id ? { driverId: row.driver_id } : {}),
    runOn: dayKey(row.run_on),
    status: row.status as RouteStatus,
    plannedGallons: row.planned_gallons,
    plannedMiles: row.planned_miles,
    stops,
  };
}

export interface RouteQuery {
  readonly runOn?: DayKey;
  readonly from?: DayKey;
  readonly to?: DayKey;
  readonly truckId?: string;
  readonly driverId?: string;
  readonly status?: RouteStatus;
  readonly openOnly?: boolean;
}

export class RouteRepository {
  constructor(private readonly db: Db) {}

  /** Writes the route and every stop as one unit, replacing any stops it had. */
  save(route: Route): void {
    inTransaction(this.db, () => {
      try {
        this.db
          .prepare(
            `INSERT INTO routes (id, truck_id, driver_id, run_on, status, planned_gallons, planned_miles)
             VALUES (@id, @truckId, @driverId, @runOn, @status, @plannedGallons, @plannedMiles)
             ON CONFLICT (id) DO UPDATE SET
               truck_id = excluded.truck_id,
               driver_id = excluded.driver_id,
               run_on = excluded.run_on,
               status = excluded.status,
               planned_gallons = excluded.planned_gallons,
               planned_miles = excluded.planned_miles`,
          )
          .run({
            id: route.id,
            truckId: route.truckId,
            driverId: route.driverId ?? null,
            runOn: route.runOn,
            status: route.status,
            plannedGallons: route.plannedGallons,
            plannedMiles: route.plannedMiles,
          });
      } catch (error) {
        const text = String(error);
        if (text.includes('routes_truck_day') || text.includes('routes.truck_id')) {
          throw new ConflictError(`truck ${route.truckId} already has a route on ${route.runOn}`, {
            truckId: route.truckId,
            runOn: route.runOn,
          });
        }
        throw error;
      }
      this.db.prepare('DELETE FROM route_stops WHERE route_id = ?').run(route.id);
      const insert = this.db.prepare(
        `INSERT INTO route_stops (id, route_id, tank_id, customer_id, position,
           planned_gallons, outcome, delivery_id, note)
         VALUES (@id, @routeId, @tankId, @customerId, @position, @plannedGallons,
           @outcome, @deliveryId, @note)`,
      );
      for (const stop of route.stops) {
        insert.run({
          id: stop.id,
          routeId: route.id,
          tankId: stop.tankId,
          customerId: stop.customerId,
          position: stop.position,
          plannedGallons: stop.plannedGallons,
          outcome: stop.outcome,
          deliveryId: stop.deliveryId ?? null,
          note: stop.note ?? null,
        });
      }
    });
  }

  private stopsFor(routeId: string): RouteStop[] {
    return this.db
      .prepare<[string], StopRow>('SELECT * FROM route_stops WHERE route_id = ? ORDER BY position')
      .all(routeId)
      .map(toStop);
  }

  find(id: string): Route | undefined {
    const row = this.db.prepare<[string], RouteRow>('SELECT * FROM routes WHERE id = ?').get(id);
    return row ? toRoute(row, this.stopsFor(row.id)) : undefined;
  }

  get(id: string): Route {
    const route = this.find(id);
    if (!route) {
      throw new NotFoundError('route', id);
    }
    return route;
  }

  list(query: RouteQuery = {}): Route[] {
    const where = new WhereClause()
      .eq('run_on', 'runOn', query.runOn)
      .gte('run_on', 'from', query.from)
      .lte('run_on', 'to', query.to)
      .eq('truck_id', 'truckId', query.truckId)
      .eq('driver_id', 'driverId', query.driverId)
      .eq('status', 'status', query.status)
      .when(query.openOnly, "status NOT IN ('closed', 'cancelled')");
    return this.db
      .prepare<Record<string, unknown>, RouteRow>(
        `SELECT * FROM routes ${where.sql} ORDER BY run_on, truck_id`,
      )
      .all(where.bind())
      .map((row) => toRoute(row, this.stopsFor(row.id)));
  }

  /** Moves the route along, refusing anything that is not a legal next step. */
  setStatus(id: string, status: RouteStatus): void {
    const route = this.get(id);
    if (route.status === status) {
      return;
    }
    if (!canMoveTo(route.status, status)) {
      throw new ConflictError(`a ${route.status} route cannot become ${status}`, {
        id,
        from: route.status,
        to: status,
      });
    }
    this.db.prepare('UPDATE routes SET status = ? WHERE id = ?').run(status, id);
  }

  assignDriver(id: string, driverId: string | null): void {
    const result = this.db
      .prepare('UPDATE routes SET driver_id = ? WHERE id = ?')
      .run(driverId, id);
    if (result.changes === 0) {
      throw new NotFoundError('route', id);
    }
  }

  settleStop(
    stopId: string,
    outcome: StopOutcome,
    detail: { deliveryId?: string; note?: string } = {},
  ): void {
    const result = this.db
      .prepare('UPDATE route_stops SET outcome = ?, delivery_id = ?, note = ? WHERE id = ?')
      .run(outcome, detail.deliveryId ?? null, detail.note ?? null, stopId);
    if (result.changes === 0) {
      throw new NotFoundError('route stop', stopId);
    }
  }

  /** Every stop still waiting on a truck, across all open routes. */
  outstandingStops(runOn: DayKey): RouteStop[] {
    return this.db
      .prepare<[string], StopRow>(
        `SELECT s.* FROM route_stops s
           JOIN routes r ON r.id = s.route_id
          WHERE r.run_on = ? AND s.outcome = 'pending' AND r.status <> 'cancelled'
          ORDER BY r.truck_id, s.position`,
      )
      .all(runOn)
      .map(toStop);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM routes WHERE id = ?').run(id).changes > 0;
  }
}
