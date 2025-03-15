import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  DomainError,
  InsufficientHistoryError,
  InvalidInputError,
  NotFoundError,
  OverfillError,
  PermissionDeniedError,
  RouteCapacityError,
  ServiceInterruptedError,
  describeError,
  errorCodeOf,
  isDomainError,
} from '../../../src/core/errors';

describe('DomainError', () => {
  it('carries a code and a detail bag', () => {
    const error = new DomainError('conflict', 'two drivers on one truck', { truckId: 'B-4' });
    expect(error.code).toBe('conflict');
    expect(error.detail).toEqual({ truckId: 'B-4' });
    expect(error.name).toBe('DomainError');
  });

  it('serialises to something an api can send', () => {
    const error = new DomainError('not_found', 'gone', { id: '7' });
    expect(error.toJSON()).toEqual({ code: 'not_found', message: 'gone', detail: { id: '7' } });
  });

  it('takes its name from the subclass', () => {
    expect(new NotFoundError('tank', 'T-9').name).toBe('NotFoundError');
  });
});

describe('the specific failures', () => {
  it('names what was missing', () => {
    const error = new NotFoundError('tank', 'T-9');
    expect(error.message).toBe('no tank with id T-9');
    expect(error.code).toBe('not_found');
  });

  it('reports a conflict with detail', () => {
    expect(new ConflictError('already delivered', { ticket: '881' }).detail).toEqual({
      ticket: '881',
    });
  });

  it('reports bad input', () => {
    expect(new InvalidInputError('gauge over one hundred').code).toBe('invalid_input');
  });

  it('says how much history the burn model wanted', () => {
    const error = new InsufficientHistoryError('T-9', 1, 3);
    expect(error.message).toMatch(/1 usable fill intervals/);
    expect(error.detail.needed).toBe(3);
  });

  it('says how much room was actually left', () => {
    const error = new OverfillError('T-9', 400, 260);
    expect(error.message).toMatch(/room is 260/);
    expect(error.code).toBe('tank_would_overfill');
  });

  it('says how far over the truck was planned', () => {
    const error = new RouteCapacityError('B-4', 3100, 2800);
    expect(error.detail).toEqual({ truckId: 'B-4', planned: 3100, capacity: 2800 });
  });

  it('treats an out of gas call as a safety event', () => {
    const error = new ServiceInterruptedError('T-9', '2025-01-14');
    expect(error.message).toMatch(/leak check/);
    expect(error.code).toBe('service_interrupted');
  });

  it('reports a denied action', () => {
    expect(new PermissionDeniedError('void a ticket').message).toBe('not allowed to void a ticket');
  });
});

describe('isDomainError', () => {
  it('separates ours from everything else', () => {
    expect(isDomainError(new NotFoundError('tank', 'T-1'))).toBe(true);
    expect(isDomainError(new Error('boom'))).toBe(false);
    expect(isDomainError('boom')).toBe(false);
  });
});

describe('errorCodeOf', () => {
  it('falls back to unavailable for a stranger', () => {
    expect(errorCodeOf(new ConflictError('x'))).toBe('conflict');
    expect(errorCodeOf(new TypeError('x'))).toBe('unavailable');
    expect(errorCodeOf(null)).toBe('unavailable');
  });
});

describe('describeError', () => {
  it('folds the detail into the line', () => {
    expect(describeError(new NotFoundError('tank', 'T-9'))).toBe(
      'not_found: no tank with id T-9 (what=tank id=T-9)',
    );
  });

  it('leaves off empty parentheses', () => {
    expect(describeError(new ConflictError('busy'))).toBe('conflict: busy');
  });

  it('handles a plain error', () => {
    expect(describeError(new TypeError('bad'))).toBe('TypeError: bad');
  });

  it('handles something that is not an error at all', () => {
    expect(describeError(42)).toBe('unknown: 42');
    expect(describeError(undefined)).toBe('unknown: undefined');
  });
});
