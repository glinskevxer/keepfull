import { AppContext } from '../service/context';
import { Appliance, makeTank } from '../model/tank';
import { DayKey, addDays, dayKey, dayRange, monthDay } from '../util/dates';
import { DeliveryMode, RateClass, makeCustomer } from '../model/customer';
import { fahrenheit, percent } from '../core/units';
import { inTransaction } from '../db/connection';
import { makeDriver, makeTruck } from '../model/fleet';
import { makeSchedule } from '../core/pricing';
import { makeStation } from '../model/station';
import { parseMills } from '../util/money';
import { ticketNumber } from '../util/ids';
import { toGrossGallons } from '../core/volume-correction';

/**
 * Builds a yard that behaves like the real one, for development and for the
 * end to end tests.
 *
 * It is deterministic. Everything random comes out of a seeded generator, so a
 * failure on somebody's laptop is a failure on everybody's, and the numbers in
 * a test can be written down rather than discovered by running it.
 */

/** Small deterministic generator. Not cryptographic and does not need to be. */
export class Rng {
  private state: number;

  constructor(seed = 20250217) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    // xorshift32, which is plenty for making a plausible yard.
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 0x1_0000_0000;
  }

  between(low: number, high: number): number {
    return low + this.next() * (high - low);
  }

  intBetween(low: number, high: number): number {
    return Math.floor(this.between(low, high + 1));
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) {
      throw new Error('cannot pick from an empty list');
    }
    return values[Math.min(values.length - 1, Math.floor(this.next() * values.length))] as T;
  }
}

export interface SeedOptions {
  readonly customers?: number;
  readonly from?: DayKey;
  readonly to?: DayKey;
  readonly seed?: number;
}

export interface SeedSummary {
  readonly stations: number;
  readonly customers: number;
  readonly tanks: number;
  readonly deliveries: number;
  readonly observations: number;
  readonly trucks: number;
}

const TOWNS: readonly {
  town: string;
  county: string;
  postalCode: string;
  lat: number;
  lon: number;
}[] = [
  { town: 'Danby', county: 'Tompkins', postalCode: '14883', lat: 42.3406, lon: -76.4901 },
  { town: 'Newfield', county: 'Tompkins', postalCode: '14867', lat: 42.3595, lon: -76.5949 },
  { town: 'Dryden', county: 'Tompkins', postalCode: '13053', lat: 42.4948, lon: -76.2971 },
  { town: 'Berkshire', county: 'Tioga', postalCode: '13736', lat: 42.3009, lon: -76.1866 },
  { town: 'Van Etten', county: 'Chemung', postalCode: '14889', lat: 42.1998, lon: -76.5688 },
];

const APPLIANCE_SETS: readonly Appliance[][] = [
  ['furnace', 'water_heater'],
  ['furnace', 'water_heater', 'range'],
  ['boiler', 'water_heater', 'clothes_dryer'],
  ['furnace', 'water_heater', 'fireplace', 'generator'],
  ['shop_heater', 'water_heater'],
  ['range', 'water_heater'],
];

/**
 * A plausible winter. A cosine through the year gives the seasonal shape and
 * the generator adds the day to day swing, which is what makes a burn model
 * fitted against this behave like one fitted against real weather.
 */
export function meanTemperatureOn(day: DayKey, rng: Rng): number {
  const month = Number(monthDay(day).slice(0, 2));
  const dayOfMonth = Number(monthDay(day).slice(3));
  const dayOfYear = month * 30 + dayOfMonth;
  const seasonal = 46 - 26 * Math.cos((2 * Math.PI * (dayOfYear - 15)) / 365);
  return seasonal + rng.between(-12, 12);
}

export function seed(context: AppContext, options: SeedOptions = {}): SeedSummary {
  const rng = new Rng(options.seed ?? 20250217);
  const to = options.to ?? dayKey('2026-03-31');
  const from = options.from ?? addDays(to, -730);
  const wanted = options.customers ?? 40;

  return inTransaction(context.db, () => {
    const stations = [
      makeStation({
        id: 'KITH',
        name: 'Ithaca Tompkins Regional',
        latitude: 42.4908,
        longitude: -76.4584,
        elevationFeet: 1099,
      }),
      makeStation({
        id: 'KELM',
        name: 'Elmira Corning Regional',
        latitude: 42.1599,
        longitude: -76.8916,
        elevationFeet: 954,
      }),
    ];
    for (const station of stations) {
      context.weather.saveStation(station);
    }

    const recordedAt = context.clock();
    let observations = 0;
    for (const day of dayRange(from, to)) {
      for (const station of stations) {
        const mean = meanTemperatureOn(day, rng);
        const spread = rng.between(8, 22);
        context.weather.recordObservation(
          station.id,
          {
            day,
            high: fahrenheit(Math.round(mean + spread / 2)),
            low: fahrenheit(Math.round(mean - spread / 2)),
          },
          recordedAt,
        );
        observations += 1;
      }
      for (const station of stations) {
        const key = monthDay(day);
        const month = Number(key.slice(0, 2));
        const dayOfMonth = Number(key.slice(3));
        const seasonal = 46 - 26 * Math.cos((2 * Math.PI * (month * 30 + dayOfMonth - 15)) / 365);
        context.weather.saveNormal(station.id, key, Math.max(0, Math.round(65 - seasonal)));
      }
    }

    const trucks = [
      makeTruck({
        id: 'trk-b4',
        unitNumber: 'B-4',
        waterCapacity: 3000,
        meterSealedOn: '2025-09-01',
      }),
      makeTruck({
        id: 'trk-b7',
        unitNumber: 'B-7',
        waterCapacity: 2600,
        meterSealedOn: '2025-10-15',
      }),
    ];
    for (const truck of trucks) {
      context.fleet.saveTruck(truck);
    }
    context.fleet.saveDriver(
      makeDriver({
        id: 'drv-1',
        name: 'R Vandemark',
        licenceNumber: 'NY-882-441',
        endorsements: ['hazmat', 'tanker', 'air_brakes'],
        medicalCardExpiresOn: '2027-04-01',
      }),
    );
    context.fleet.saveDriver(
      makeDriver({
        id: 'drv-2',
        name: 'A Olney',
        licenceNumber: 'NY-114-902',
        endorsements: ['hazmat', 'tanker'],
        medicalCardExpiresOn: '2026-11-30',
      }),
    );

    for (const rateClass of ['residential', 'commercial', 'agricultural'] as RateClass[]) {
      const base = rateClass === 'residential' ? 3.499 : rateClass === 'commercial' ? 3.199 : 2.999;
      context.pricing.saveSchedule(
        makeSchedule({
          id: `prc-${rateClass}`,
          rateClass,
          effectiveFrom: dayKey('2025-09-01'),
          tiers: [
            { fromGallons: 0, pricePerGallon: parseMills(base.toFixed(4)) },
            { fromGallons: 150, pricePerGallon: parseMills((base - 0.25).toFixed(4)) },
            { fromGallons: 300, pricePerGallon: parseMills((base - 0.5).toFixed(4)) },
            { fromGallons: 500, pricePerGallon: parseMills((base - 0.75).toFixed(4)) },
          ],
        }),
      );
    }

    let tanks = 0;
    let deliveries = 0;
    let ticketSerial = 100_000;

    for (let index = 0; index < wanted; index += 1) {
      const place = rng.pick(TOWNS);
      const mode = rng.pick<DeliveryMode>([
        'keep_full',
        'keep_full',
        'keep_full',
        'will_call',
        'budget',
      ]);
      const rateClass = rng.pick<RateClass>([
        'residential',
        'residential',
        'residential',
        'commercial',
        'agricultural',
      ]);
      const customer = makeCustomer({
        id: `cus-${String(index + 1).padStart(4, '0')}`,
        accountNumber: `04-${String(110_000 + index).padStart(6, '0')}`,
        billingName: `${rng.pick(['Merrick', 'Hollis', 'Bradmoor', 'Teeter', 'Vann', 'Aldrich'])} ${rng.pick(['Farms', 'Property', 'Holdings', 'Household'])}`,
        address: {
          line1: `${rng.intBetween(100, 9000)} ${rng.pick(['Bell Hollow', 'Ridge', 'Coddington', 'Van Kirk', 'Stillwell'])} Rd`,
          town: place.town,
          county: place.county,
          postalCode: place.postalCode,
          latitude: place.lat + rng.between(-0.05, 0.05),
          longitude: place.lon + rng.between(-0.05, 0.05),
        },
        deliveryMode: mode,
        rateClass,
        stationId: place.county === 'Chemung' ? 'KELM' : 'KITH',
        openedOn: '2018-06-01',
      });
      context.customers.insert(customer);

      const capacity = rng.pick([250, 320, 500, 500, 1000]);
      const tank = makeTank({
        id: `tnk-${String(index + 1).padStart(4, '0')}`,
        customerId: customer.id,
        serialNumber: `TR-${String(880_000 + index)}`,
        waterCapacity: capacity,
        owner: rng.next() < 0.85 ? 'company' : 'customer',
        appliances: rng.pick(APPLIANCE_SETS),
        installedOn: '2018-06-15',
        lastLeakCheckOn: '2023-05-01',
        ...(rng.next() < 0.4 ? { monitorId: `WT-${4000 + index}` } : {}),
      });
      context.tanks.insert(tank);
      tanks += 1;

      // Walk the tank through the history, filling it whenever it would have
      // reached its reserve mark, which is what produces a history the burn
      // model can actually fit.
      const perDegreeDay = rng.between(0.18, 0.42) * (capacity / 500);
      const baseLoad = rng.between(0.3, 1.6);
      let level = capacity * 0.8 * rng.between(0.55, 0.95);
      let lastFill = from;
      for (const day of dayRange(from, to)) {
        const mean = meanTemperatureOn(day, rng);
        const heating = Math.max(0, 65 - mean);
        level -= baseLoad + perDegreeDay * heating;
        const reserve = capacity * 0.25;
        if (level > reserve || day <= addDays(lastFill, 6)) {
          continue;
        }
        const gaugeBefore = Math.max(2, Math.min(79, Math.round((level / capacity) * 100)));
        const netDrop = Math.round((capacity * 0.8 - (gaugeBefore / 100) * capacity) * 10) / 10;
        const temperature = Math.round(Math.max(-10, Math.min(90, mean)));
        const gross =
          Math.round(toGrossGallons(netDrop as never, fahrenheit(temperature)) * 10) / 10;
        ticketSerial += 1;
        context.deliveries.insert({
          id: `dlv-${ticketSerial}`,
          ticketNumber: ticketNumber(ticketSerial),
          customerId: customer.id,
          tankId: tank.id,
          deliveredOn: day,
          gross: gross as never,
          meterTemperature: fahrenheit(temperature),
          net: netDrop as never,
          gaugeBefore: percent(gaugeBefore),
          gaugeAfter: percent(80),
          reason: 'scheduled',
          status: 'posted',
          driverId: rng.pick(['drv-1', 'drv-2']),
          truckId: rng.pick(['trk-b4', 'trk-b7']),
        });
        deliveries += 1;
        level = capacity * 0.8;
        lastFill = day;
      }
    }

    return {
      stations: stations.length,
      customers: wanted,
      tanks,
      deliveries,
      observations,
      trucks: trucks.length,
    };
  });
}
