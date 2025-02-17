/**
 * Small assertion helpers. These exist because the delivery math throws on bad
 * input rather than quietly producing a number that looks plausible. A tank
 * percentage of 140 is a broken gauge, not a full tank, and the caller has to
 * hear about it.
 */

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new AssertionError(message);
  }
}

export function assertFinite(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AssertionError(`${label} must be a finite number, got ${String(value)}`);
  }
  return value;
}

export function assertNonNegative(value: number, label: string): number {
  assertFinite(value, label);
  if (value < 0) {
    throw new AssertionError(`${label} must not be negative, got ${value}`);
  }
  return value;
}

export function assertPositive(value: number, label: string): number {
  assertFinite(value, label);
  if (value <= 0) {
    throw new AssertionError(`${label} must be greater than zero, got ${value}`);
  }
  return value;
}

export function assertInRange(value: number, low: number, high: number, label: string): number {
  assertFinite(value, label);
  if (value < low || value > high) {
    throw new AssertionError(`${label} must be between ${low} and ${high}, got ${value}`);
  }
  return value;
}

export function assertInteger(value: number, label: string): number {
  assertFinite(value, label);
  if (!Number.isInteger(value)) {
    throw new AssertionError(`${label} must be a whole number, got ${value}`);
  }
  return value;
}

export function assertNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AssertionError(`${label} must not be blank`);
  }
  return value;
}

/** Narrows an optional to a value, used where the type system cannot see the guard. */
export function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new AssertionError(`${label} is required`);
  }
  return value;
}

/** Exhaustiveness check for switch statements over union types. */
export function unreachable(value: never, label = 'value'): never {
  throw new AssertionError(`unexpected ${label}: ${JSON.stringify(value)}`);
}
