import { AppContext, currentDay } from '../service/context';
import { AuditContext } from '../service/audit';
import { DayKey, addDays } from '../util/dates';
import { FastifyRequest } from 'fastify';
import { optionalDay } from './query-params';

/**
 * Two things every write and every report endpoint needed, written out three
 * and two times respectively.
 *
 * The actor one matters more than it looks. The audit trail is only worth
 * having if it names who did something, and the version of that expression in
 * the office routes had `?? 'system'` where the others had `?? 'unknown'`, so
 * an unauthenticated write through that path was recorded as the nightly job.
 */

/** Who is making this request, for the audit trail. */
export function callerOf(request: FastifyRequest): AuditContext {
  return {
    actor: request.caller?.name ?? 'unknown',
    ...(request.requestId ? { requestId: request.requestId } : {}),
  };
}

export interface DayRange {
  readonly from: DayKey;
  readonly to: DayKey;
}

/**
 * A day range from a query string, ending today and running back a default
 * number of days. The office links in from a dashboard with no dates on it and
 * narrows down from there, so every report has to work with neither given.
 */
export function rangeFrom(
  context: AppContext,
  query: { from?: string; to?: string },
  defaultDays: number,
): DayRange {
  const to = optionalDay(query.to) ?? currentDay(context);
  const from = optionalDay(query.from) ?? addDays(to, -defaultDays);
  if (from > to) {
    throw new Error(`the range runs backwards, ${from} is after ${to}`);
  }
  return { from, to };
}
