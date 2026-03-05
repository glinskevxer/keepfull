import { AppContext } from './context';
import { Appliance, Tank } from '../model/tank';
import { Fahrenheit, Percent, fahrenheit, percent } from '../core/units';
import { LoadCheck, checkLoad, smallestTankFor } from '../core/vaporization';
import { LoadEstimate, estimateLoad, gallonsPerHour } from '../core/appliance-load';
import { NotFoundError } from '../core/errors';

/**
 * Is the tank in the hole big enough.
 *
 * This gets asked twice: when a new account is set, and every January when
 * somebody adds a shop heater and does not tell anybody. The second case is why
 * this runs over the whole book as a job rather than only on a form.
 */

/** The coldest air this territory designs against. */
export const DESIGN_AMBIENT: Fahrenheit = fahrenheit(0);

/** The gauge a tank has to still carry its load down to. */
export const DESIGN_GAUGE: Percent = percent(30);

export interface SizingVerdict {
  readonly tankId: string;
  readonly customerId: string;
  readonly waterCapacity: number;
  readonly load: LoadEstimate;
  readonly check: LoadCheck;
  readonly gallonsPerHour: number;
  readonly recommendedCapacity: number | undefined;
  readonly undersized: boolean;
}

export interface SizingOptions {
  readonly ambient?: Fahrenheit;
  readonly downToGauge?: Percent;
  readonly diversity?: number;
}

export class SizingService {
  constructor(private readonly context: AppContext) {}

  forTank(tankId: string, options: SizingOptions = {}): SizingVerdict {
    const tank = this.context.tanks.get(tankId);
    return this.judge(tank, options);
  }

  /** What tank a set of appliances needs, before anything is in the ground. */
  forAppliances(
    appliances: readonly Appliance[],
    options: SizingOptions = {},
  ): {
    load: LoadEstimate;
    recommendedCapacity: number | undefined;
  } {
    const ambient = options.ambient ?? DESIGN_AMBIENT;
    const gauge = options.downToGauge ?? DESIGN_GAUGE;
    const load = estimateLoad(appliances, options.diversity);
    return {
      load,
      recommendedCapacity:
        load.designBtuPerHour === 0
          ? undefined
          : smallestTankFor(load.designBtuPerHour, ambient, gauge),
    };
  }

  /** Every tank that cannot carry its own load on a design day. */
  undersizedTanks(options: SizingOptions = {}): SizingVerdict[] {
    const verdicts: SizingVerdict[] = [];
    for (const tank of this.context.tanks.list({ inServiceOnly: true })) {
      const verdict = this.judge(tank, options);
      if (verdict.undersized) {
        verdicts.push(verdict);
      }
    }
    return verdicts.sort((left, right) => left.check.headroom - right.check.headroom);
  }

  private judge(tank: Tank, options: SizingOptions): SizingVerdict {
    if (this.context.customers.find(tank.customerId) === undefined) {
      throw new NotFoundError('customer', tank.customerId);
    }
    const ambient = options.ambient ?? DESIGN_AMBIENT;
    const gauge = options.downToGauge ?? DESIGN_GAUGE;
    const load = estimateLoad(tank.appliances, options.diversity);
    if (load.designBtuPerHour === 0) {
      return {
        tankId: tank.id,
        customerId: tank.customerId,
        waterCapacity: tank.waterCapacity,
        load,
        check: {
          capacityBtuPerHour: 0,
          demandBtuPerHour: 0,
          headroom: 0,
          sufficient: true,
          criticalGauge: null,
        },
        gallonsPerHour: 0,
        recommendedCapacity: undefined,
        undersized: false,
      };
    }
    const check = checkLoad(tank.waterCapacity, gauge, ambient, load.designBtuPerHour);
    return {
      tankId: tank.id,
      customerId: tank.customerId,
      waterCapacity: tank.waterCapacity,
      load,
      check,
      gallonsPerHour: Math.round(gallonsPerHour(load.designBtuPerHour) * 100) / 100,
      recommendedCapacity: smallestTankFor(load.designBtuPerHour, ambient, gauge),
      undersized: !check.sufficient,
    };
  }
}
