import { DomainError, ErrorCode, isDomainError } from '../core/errors';
import { AssertionError } from '../util/assert';
import { FieldProblem } from './schema';
import { isValidationError } from './validate';

/**
 * One response shape for every failure.
 *
 * Two things read these. The office screen, which shows `message` and puts the
 * cursor in whichever field `problems` names. And the handhelds, which retry on
 * some codes and give up on others, so the code has to be stable even when the
 * sentence changes.
 */

export interface ErrorBody {
  readonly code: ErrorCode | 'invalid_input' | 'internal';
  readonly message: string;
  readonly problems?: FieldProblem[];
  readonly detail?: Record<string, unknown>;
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  not_found: 404,
  conflict: 409,
  invalid_input: 400,
  insufficient_history: 422,
  tank_would_overfill: 422,
  route_over_capacity: 422,
  service_interrupted: 422,
  station_unavailable: 503,
  permission_denied: 403,
  unavailable: 503,
};

export function statusFor(error: unknown): number {
  if (isDomainError(error)) {
    return STATUS_BY_CODE[error.code] ?? 500;
  }
  if (error instanceof AssertionError) {
    return 400;
  }
  return 500;
}

export function bodyFor(error: unknown): ErrorBody {
  if (isValidationError(error)) {
    return { code: 'invalid_input', message: error.message, problems: error.problems };
  }
  if (isDomainError(error)) {
    const domain = error as DomainError;
    return {
      code: domain.code,
      message: domain.message,
      ...(Object.keys(domain.detail).length > 0 ? { detail: { ...domain.detail } } : {}),
    };
  }
  if (error instanceof AssertionError) {
    return { code: 'invalid_input', message: error.message };
  }
  // Anything else is a defect in this system, and the caller gets nothing that
  // would help them work out what. The log has the real thing.
  return { code: 'internal', message: 'something went wrong at our end' };
}

export function validationBody(problems: FieldProblem[]): ErrorBody {
  return {
    code: 'invalid_input',
    message: problems.length === 1 ? 'one field is wrong' : `${problems.length} fields are wrong`,
    problems,
  };
}
