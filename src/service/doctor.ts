import { AppContext, currentDay } from './context';
import { MIGRATIONS } from '../db/migrations';
import { Settings } from '../config/env';
import { daysBetween } from '../util/dates';
import { integrityCheck } from '../db/connection';
import { pendingMigrations, readVersion } from '../db/migrate';
import { straightLineMiles } from '../core/route/distance';

/**
 * What is wrong with this installation, as opposed to what is wrong with the
 * book.
 *
 * The morning board answers "what does the yard have to deal with today". This
 * answers "is this deployment actually going to work", and it is the thing to
 * run after a deploy, after a restore, and at seven in the morning when
 * somebody says the forecasts look wrong.
 *
 * Every check here has been the answer at least once.
 */

export type Severity = 'blocking' | 'warning' | 'note';

export interface Finding {
  readonly check: string;
  readonly severity: Severity;
  readonly detail: string;
}

export interface Diagnosis {
  readonly findings: Finding[];
  readonly blocking: number;
  readonly warnings: number;
  readonly healthy: boolean;
}

/** A station with no weather in this long is not being fed. */
export const STALE_WEATHER_DAYS = 3;

export class DoctorService {
  constructor(
    private readonly context: AppContext,
    private readonly settings?: Settings,
  ) {}

  diagnose(): Diagnosis {
    const findings: Finding[] = [
      ...this.checkSchema(),
      ...this.checkWeather(),
      ...this.checkStations(),
      ...this.checkPricing(),
      ...this.checkFleet(),
      ...this.checkYard(),
    ];
    const blocking = findings.filter((finding) => finding.severity === 'blocking').length;
    return {
      findings,
      blocking,
      warnings: findings.filter((finding) => finding.severity === 'warning').length,
      healthy: blocking === 0,
    };
  }

  private checkSchema(): Finding[] {
    const findings: Finding[] = [];
    const pending = pendingMigrations(this.context.db, MIGRATIONS);
    if (pending.length > 0) {
      findings.push({
        check: 'schema',
        severity: 'blocking',
        detail: `${pending.length} migrations have not run, the newest applied is ${readVersion(this.context.db)}`,
      });
    }
    const integrity = integrityCheck(this.context.db);
    if (integrity !== 'ok') {
      findings.push({
        check: 'schema',
        severity: 'blocking',
        detail: `integrity says ${integrity}`,
      });
    }
    return findings;
  }

  private checkWeather(): Finding[] {
    const today = currentDay(this.context);
    const findings: Finding[] = [];
    for (const station of this.context.weather.listStations({ activeOnly: true })) {
      const latest = this.context.weather.latestObservationDay(station.id);
      if (latest === undefined) {
        findings.push({
          check: 'weather',
          severity: 'blocking',
          detail: `${station.id} has no observations at all, nothing on it can be forecast`,
        });
        continue;
      }
      const age = daysBetween(latest, today);
      if (age > STALE_WEATHER_DAYS) {
        findings.push({
          check: 'weather',
          severity: 'blocking',
          detail: `${station.id} has had nothing since ${latest}, ${age} days ago`,
        });
      }
      if (this.context.weather.loadNormals(station.id).size < 300) {
        findings.push({
          check: 'weather',
          severity: 'warning',
          detail: `${station.id} has no normal year, so projections past the real weather are flat`,
        });
      }
    }
    return findings;
  }

  private checkStations(): Finding[] {
    const findings: Finding[] = [];
    const known = new Set(this.context.weather.listStations().map((station) => station.id));
    const orphans = new Set<string>();
    for (const customer of this.context.customers.list({ openOnly: true })) {
      if (!known.has(customer.stationId)) {
        orphans.add(customer.stationId);
      }
    }
    for (const stationId of [...orphans].sort()) {
      findings.push({
        check: 'stations',
        severity: 'blocking',
        detail: `accounts point at station ${stationId}, which is not on file`,
      });
    }
    if (known.size === 0) {
      findings.push({ check: 'stations', severity: 'blocking', detail: 'there are no stations' });
    }
    return findings;
  }

  private checkPricing(): Finding[] {
    const today = currentDay(this.context);
    const classes = new Set(
      this.context.customers.list({ openOnly: true }).map((customer) => customer.rateClass),
    );
    return [...classes]
      .filter((rateClass) => this.context.pricing.scheduleInForce(rateClass, today) === undefined)
      .sort()
      .map((rateClass) => ({
        check: 'pricing',
        severity: 'warning' as const,
        detail: `no price schedule in force for ${rateClass}, those tickets cannot be priced`,
      }));
  }

  private checkFleet(): Finding[] {
    const trucks = this.context.fleet.listTrucks({ activeOnly: true, kind: 'bobtail' });
    if (trucks.length === 0) {
      return [
        {
          check: 'fleet',
          severity: 'blocking',
          detail: 'no active bobtail, nothing can be planned',
        },
      ];
    }
    const drivers = this.context.fleet.listDrivers({ activeOnly: true });
    return drivers.length === 0
      ? [{ check: 'fleet', severity: 'warning', detail: 'no active driver to release a route to' }]
      : [];
  }

  private checkYard(): Finding[] {
    if (!this.settings) {
      return [];
    }
    const customers = this.context.customers.list({ openOnly: true });
    if (customers.length === 0) {
      return [];
    }
    // A yard coordinate keyed with the sign wrong puts every route through the
    // Indian Ocean, and nothing else notices.
    const worst = Math.max(
      ...customers.map((customer) =>
        straightLineMiles(this.settings!.yard, {
          latitude: customer.address.latitude,
          longitude: customer.address.longitude,
        }),
      ),
    );
    return worst > 300
      ? [
          {
            check: 'yard',
            severity: 'warning',
            detail: `the furthest account is ${Math.round(worst)} miles from the yard, check the coordinates`,
          },
        ]
      : [];
  }
}
