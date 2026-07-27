import { AppContext } from './context';
import { Customer } from '../model/customer';
import { NotFoundError } from '../core/errors';
import { Point, straightLineMiles } from '../core/route/distance';
import { Station } from '../model/station';
import { inTransaction } from '../db/connection';
import { round } from '../util/round';

/**
 * Which station's weather an account is forecast against.
 *
 * Accounts were assigned by hand when this dealer had one station, and the hand
 * assignments survived the second and third stations being added. Roughly one
 * account in six is now pointed at a station that is not its nearest, which
 * quietly costs the forecast a few hundred degree days a winter on the accounts
 * furthest out.
 *
 * Elevation matters as much as distance in these valleys, so the choice is made
 * on a straight line distance with a penalty for the height difference rather
 * than on distance alone. Six hundred feet of climb is worth about four miles.
 */

/** Miles of penalty per thousand feet of elevation difference. */
export const ELEVATION_PENALTY_MILES = 6.7;

export interface StationChoice {
  readonly stationId: string;
  readonly miles: number;
  readonly elevationDifference: number;
  readonly effectiveMiles: number;
}

export interface Misassignment {
  readonly customerId: string;
  readonly accountNumber: string;
  readonly current: StationChoice;
  readonly nearest: StationChoice;
  readonly milesSaved: number;
}

function pointOf(customer: Customer): Point {
  return { latitude: customer.address.latitude, longitude: customer.address.longitude };
}

/**
 * Elevation for an account is not on file, so the station's own elevation is
 * used as a stand in for the one it is currently assigned to. That is enough to
 * stop a ridge account being pulled onto a lake shore station a mile closer.
 */
function chooseFrom(
  customer: Customer,
  stations: readonly Station[],
  assumedElevation: number,
): StationChoice[] {
  return stations
    .map((station) => {
      const miles = straightLineMiles(pointOf(customer), station);
      const elevationDifference = Math.abs(station.elevationFeet - assumedElevation);
      return {
        stationId: station.id,
        miles: round(miles, 2),
        elevationDifference: round(elevationDifference, 0),
        effectiveMiles: round(miles + (elevationDifference / 1000) * ELEVATION_PENALTY_MILES, 2),
      };
    })
    .sort((left, right) => left.effectiveMiles - right.effectiveMiles);
}

export class TerritoryService {
  constructor(private readonly context: AppContext) {}

  /** Every active station ranked for one account, nearest first. */
  rank(customerId: string): StationChoice[] {
    const customer = this.context.customers.get(customerId);
    const stations = this.context.weather.listStations({ activeOnly: true });
    if (stations.length === 0) {
      throw new NotFoundError('active station', 'any');
    }
    const current = this.context.weather.findStation(customer.stationId);
    return chooseFrom(customer, stations, current?.elevationFeet ?? stations[0]!.elevationFeet);
  }

  nearest(customerId: string): StationChoice {
    return this.rank(customerId)[0] as StationChoice;
  }

  /** Accounts pointed at a station that is not their nearest. */
  misassigned(minimumMilesSaved = 3): Misassignment[] {
    const stations = this.context.weather.listStations({ activeOnly: true });
    if (stations.length < 2) {
      return [];
    }
    const found: Misassignment[] = [];
    for (const customer of this.context.customers.list({ openOnly: true })) {
      const ranked = this.rank(customer.id);
      const nearest = ranked[0] as StationChoice;
      const current = ranked.find((choice) => choice.stationId === customer.stationId);
      if (!current || current.stationId === nearest.stationId) {
        continue;
      }
      const milesSaved = round(current.effectiveMiles - nearest.effectiveMiles, 2);
      if (milesSaved < minimumMilesSaved) {
        continue;
      }
      found.push({
        customerId: customer.id,
        accountNumber: customer.accountNumber,
        current,
        nearest,
        milesSaved,
      });
    }
    return found.sort((left, right) => right.milesSaved - left.milesSaved);
  }

  /** Moves every misassigned account onto its nearest station. */
  reassignAll(minimumMilesSaved = 3): { moved: number; accounts: string[] } {
    const moves = this.misassigned(minimumMilesSaved);
    inTransaction(this.context.db, () => {
      for (const move of moves) {
        const customer = this.context.customers.get(move.customerId);
        this.context.customers.update({ ...customer, stationId: move.nearest.stationId });
      }
    });
    if (moves.length > 0) {
      this.context.logger.info('reassigned accounts to nearer stations', { moved: moves.length });
    }
    return { moved: moves.length, accounts: moves.map((move) => move.accountNumber) };
  }

  /** How the book is spread across the stations. */
  coverage(): { stationId: string; name: string; accounts: number; active: boolean }[] {
    return this.context.weather.listStations().map((station) => ({
      stationId: station.id,
      name: station.name,
      accounts: this.context.customers.count({ stationId: station.id }),
      active: station.active,
    }));
  }
}
