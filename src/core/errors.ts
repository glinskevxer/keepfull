/**
 * Every failure this system reports has to survive three hops: the office
 * screen, the driver's handheld, and the nightly job log. A bare Error string
 * does not survive any of them, so failures carry a stable code, a human
 * sentence and whatever detail the caller needs to act.
 */

export type ErrorCode =
  | 'not_found'
  | 'conflict'
  | 'invalid_input'
  | 'insufficient_history'
  | 'tank_would_overfill'
  | 'route_over_capacity'
  | 'service_interrupted'
  | 'station_unavailable'
  | 'permission_denied'
  | 'unavailable';

export interface ErrorDetail {
  readonly [key: string]: string | number | boolean | null | undefined;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly detail: ErrorDetail;

  constructor(code: ErrorCode, message: string, detail: ErrorDetail = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.detail = detail;
  }

  toJSON(): { code: ErrorCode; message: string; detail: ErrorDetail } {
    return { code: this.code, message: this.message, detail: this.detail };
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string, id: string) {
    super('not_found', `no ${what} with id ${id}`, { what, id });
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, detail: ErrorDetail = {}) {
    super('conflict', message, detail);
  }
}

export class InvalidInputError extends DomainError {
  constructor(message: string, detail: ErrorDetail = {}) {
    super('invalid_input', message, detail);
  }
}

/** Raised when there are not enough fills behind a tank to fit a burn rate. */
export class InsufficientHistoryError extends DomainError {
  constructor(tankId: string, intervals: number, needed: number) {
    super(
      'insufficient_history',
      `tank ${tankId} has ${intervals} usable fill intervals, the burn model needs ${needed}`,
      { tankId, intervals, needed },
    );
  }
}

export class OverfillError extends DomainError {
  constructor(tankId: string, requested: number, room: number) {
    super(
      'tank_would_overfill',
      `dropping ${requested} gallons into tank ${tankId} passes the filling limit, room is ${room}`,
      { tankId, requested, room },
    );
  }
}

export class RouteCapacityError extends DomainError {
  constructor(truckId: string, planned: number, capacity: number) {
    super(
      'route_over_capacity',
      `truck ${truckId} is planned for ${planned} gallons against a working capacity of ${capacity}`,
      { truckId, planned, capacity },
    );
  }
}

/** A customer ran out. That is a safety event, not just a missed delivery. */
export class ServiceInterruptedError extends DomainError {
  constructor(tankId: string, day: string) {
    super('service_interrupted', `tank ${tankId} lost pressure on ${day} and needs a leak check`, {
      tankId,
      day,
    });
  }
}

export class PermissionDeniedError extends DomainError {
  constructor(action: string) {
    super('permission_denied', `not allowed to ${action}`, { action });
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

export function errorCodeOf(value: unknown): ErrorCode {
  return isDomainError(value) ? value.code : 'unavailable';
}

/** Turns anything thrown into something that can be logged without exploding. */
export function describeError(value: unknown): string {
  if (isDomainError(value)) {
    const detail = Object.entries(value.detail)
      .map(([key, entry]) => `${key}=${String(entry)}`)
      .join(' ');
    return detail
      ? `${value.code}: ${value.message} (${detail})`
      : `${value.code}: ${value.message}`;
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  return `unknown: ${String(value)}`;
}
