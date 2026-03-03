import { Fahrenheit, Percent } from './units';
import { assertInRange, assertPositive } from '../util/assert';

/**
 * Whether a tank can actually keep up with what is hanging off it.
 *
 * Propane leaves a tank as vapour, and the liquid has to boil to supply it. The
 * heat for that boiling comes through the wetted wall of the tank from the air
 * outside, so the rate a tank can deliver depends on three things: how much of
 * its shell is in contact with liquid, how cold it is outside, and how cold the
 * liquid has got. None of that is on the data plate.
 *
 * This matters twice a year and matters a lot when it does. A five hundred
 * gallon tank on a house is fine. The same tank at thirty percent on a grain
 * dryer in October will frost over and the burner will drop out, and the
 * customer will report it as bad gas.
 */

/** Physical shape of the standard tanks, taken off the manufacturer drawings. */
interface Shell {
  readonly diameterFeet: number;
  readonly lengthFeet: number;
}

const SHELLS: Readonly<Record<number, Shell>> = {
  120: { diameterFeet: 2.0, lengthFeet: 4.5 },
  250: { diameterFeet: 2.5, lengthFeet: 7.7 },
  320: { diameterFeet: 2.5, lengthFeet: 9.5 },
  500: { diameterFeet: 3.0, lengthFeet: 9.9 },
  1000: { diameterFeet: 3.3, lengthFeet: 16.1 },
};

/**
 * Heat moving into the liquid, in BTU per hour per square foot of wetted shell
 * per degree of difference. This is not a wall conductivity, it is the whole
 * path lumped together: air to steel, steel to liquid, and the boiling itself.
 * Two hundred is what falls out of fitting the published vaporization tables
 * for these tank sizes, and it is on the conservative side because those tables
 * assume still air.
 */
export const WALL_COEFFICIENT = 200;

/**
 * The liquid temperature this assumes. Propane boils at about forty four below
 * at atmospheric pressure, but a regulator needs real pressure at its inlet, so
 * the working figure is the temperature the liquid sits at while still holding
 * enough vapour pressure to run.
 */
export const WORKING_BOILING_POINT: Fahrenheit = -30 as Fahrenheit;

export function shellFor(waterCapacity: number): Shell {
  const shell = SHELLS[waterCapacity];
  if (!shell) {
    throw new Error(`no shell drawing for a ${waterCapacity} gallon tank`);
  }
  return shell;
}

export function knownCapacities(): number[] {
  return Object.keys(SHELLS)
    .map(Number)
    .sort((left, right) => left - right);
}

/**
 * Area of the shell in contact with liquid, in square feet, for a horizontal
 * cylinder filled to a fraction of its diameter. The ends contribute their own
 * wetted segment, which is small but not nothing on a short tank.
 */
export function wettedAreaSquareFeet(waterCapacity: number, gauge: Percent): number {
  assertInRange(gauge, 0, 100, 'gauge');
  const shell = shellFor(waterCapacity);
  const radius = shell.diameterFeet / 2;
  // Liquid depth as a fraction of the diameter. A gauge reads percent of water
  // capacity, which for a horizontal cylinder is not the same as percent of
  // depth, so this inverts the circular segment area.
  const depthFraction = depthForVolumeFraction(gauge / 100);
  const depth = depthFraction * shell.diameterFeet;
  if (depth <= 0) {
    return 0;
  }
  // Arc of the circle below the liquid line, times the length of the barrel.
  const halfAngle = Math.acos(Math.min(1, Math.max(-1, (radius - depth) / radius)));
  const barrel = 2 * halfAngle * radius * shell.lengthFeet;
  // Both end caps, as circular segments.
  const segment = radius * radius * (halfAngle - Math.sin(halfAngle) * Math.cos(halfAngle));
  return barrel + 2 * segment;
}

/**
 * For a horizontal cylinder, the fraction of the diameter the liquid reaches
 * given the fraction of the volume it occupies. Solved by bisection because the
 * relationship has no closed form worth writing out.
 */
export function depthForVolumeFraction(volumeFraction: number): number {
  assertInRange(volumeFraction, 0, 1, 'volume fraction');
  if (volumeFraction === 0) {
    return 0;
  }
  if (volumeFraction === 1) {
    return 1;
  }
  let low = 0;
  let high = 1;
  for (let step = 0; step < 60; step += 1) {
    const middle = (low + high) / 2;
    if (volumeFractionForDepth(middle) < volumeFraction) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return (low + high) / 2;
}

/** The forward relationship: fraction of volume below a given depth fraction. */
export function volumeFractionForDepth(depthFraction: number): number {
  assertInRange(depthFraction, 0, 1, 'depth fraction');
  const theta = 2 * Math.acos(1 - 2 * depthFraction);
  return (theta - Math.sin(theta)) / (2 * Math.PI);
}

/** What the tank can supply, in BTU per hour, at this level and this air temperature. */
export function vaporizationCapacity(
  waterCapacity: number,
  gauge: Percent,
  ambient: Fahrenheit,
  coefficient = WALL_COEFFICIENT,
): number {
  assertPositive(coefficient, 'wall coefficient');
  const difference = ambient - WORKING_BOILING_POINT;
  if (difference <= 0) {
    return 0;
  }
  return wettedAreaSquareFeet(waterCapacity, gauge) * coefficient * difference;
}

export interface LoadCheck {
  readonly capacityBtuPerHour: number;
  readonly demandBtuPerHour: number;
  readonly headroom: number;
  readonly sufficient: boolean;
  /** Gauge below which this tank stops keeping up, or null if it never does. */
  readonly criticalGauge: number | null;
}

/** Whether a tank at this level, at this air temperature, can carry a load. */
export function checkLoad(
  waterCapacity: number,
  gauge: Percent,
  ambient: Fahrenheit,
  demandBtuPerHour: number,
): LoadCheck {
  assertPositive(demandBtuPerHour, 'demand');
  const capacity = vaporizationCapacity(waterCapacity, gauge, ambient);
  let criticalGauge: number | null = null;
  for (let level = 100; level >= 0; level -= 1) {
    if (vaporizationCapacity(waterCapacity, level as Percent, ambient) < demandBtuPerHour) {
      criticalGauge = level;
      break;
    }
  }
  return {
    capacityBtuPerHour: Math.round(capacity),
    demandBtuPerHour,
    headroom: capacity === 0 ? -1 : capacity / demandBtuPerHour - 1,
    sufficient: capacity >= demandBtuPerHour,
    criticalGauge,
  };
}

/** The smallest tank on the yard that carries a load down to a stated gauge. */
export function smallestTankFor(
  demandBtuPerHour: number,
  ambient: Fahrenheit,
  downToGauge: Percent,
): number | undefined {
  return knownCapacities().find(
    (capacity) => vaporizationCapacity(capacity, downToGauge, ambient) >= demandBtuPerHour,
  );
}
