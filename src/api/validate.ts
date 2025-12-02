import { z } from 'zod';
import { DomainError } from '../core/errors';
import { FieldProblem, toFieldProblems } from './schema';

/**
 * A validation failure carries the field list through the normal error path
 * rather than being replied to at the call site, so every failure in the api
 * goes out through exactly one handler.
 */
export class ValidationError extends DomainError {
  readonly problems: FieldProblem[];

  constructor(problems: FieldProblem[]) {
    super(
      'invalid_input',
      problems.length === 1 ? 'one field is wrong' : `${problems.length} fields are wrong`,
    );
    this.problems = problems;
  }
}

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ValidationError(toFieldProblems(result.error));
  }
  return result.data;
}

export function isValidationError(value: unknown): value is ValidationError {
  return value instanceof ValidationError;
}
