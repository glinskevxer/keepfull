import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  InsufficientHistoryError,
  NotFoundError,
  OverfillError,
  PermissionDeniedError,
} from '../../../src/core/errors';
import { AssertionError } from '../../../src/util/assert';
import { bodyFor, statusFor, validationBody } from '../../../src/api/errors';

describe('statusFor', () => {
  it('maps the domain codes onto http', () => {
    expect(statusFor(new NotFoundError('tank', 't-1'))).toBe(404);
    expect(statusFor(new ConflictError('busy'))).toBe(409);
    expect(statusFor(new OverfillError('t-1', 400, 250))).toBe(422);
    expect(statusFor(new InsufficientHistoryError('t-1', 1, 3))).toBe(422);
    expect(statusFor(new PermissionDeniedError('void a ticket'))).toBe(403);
  });

  it('treats a broken assertion as bad input', () => {
    expect(statusFor(new AssertionError('gallons must not be negative'))).toBe(400);
  });

  it('treats anything else as ours', () => {
    expect(statusFor(new TypeError('boom'))).toBe(500);
    expect(statusFor('boom')).toBe(500);
  });
});

describe('bodyFor', () => {
  it('carries the code, the message and the detail', () => {
    expect(bodyFor(new NotFoundError('tank', 't-1'))).toEqual({
      code: 'not_found',
      message: 'no tank with id t-1',
      detail: { what: 'tank', id: 't-1' },
    });
  });

  it('leaves detail off when there is none', () => {
    expect(bodyFor(new ConflictError('busy'))).toEqual({ code: 'conflict', message: 'busy' });
  });

  it('passes an assertion message through', () => {
    expect(bodyFor(new AssertionError('percent must be between 0 and 100'))).toEqual({
      code: 'invalid_input',
      message: 'percent must be between 0 and 100',
    });
  });

  it('tells a caller nothing about a defect of ours', () => {
    const body = bodyFor(new TypeError('cannot read property x of undefined'));
    expect(body.code).toBe('internal');
    expect(body.message).not.toMatch(/undefined/);
  });
});

describe('validationBody', () => {
  it('counts the fields', () => {
    expect(validationBody([{ field: 'a', message: 'x' }]).message).toBe('one field is wrong');
    expect(
      validationBody([
        { field: 'a', message: 'x' },
        { field: 'b', message: 'y' },
      ]).message,
    ).toBe('2 fields are wrong');
  });

  it('keeps the problems', () => {
    const problems = [{ field: 'gross', message: 'too big' }];
    expect(validationBody(problems).problems).toEqual(problems);
  });
});
