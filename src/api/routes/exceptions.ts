import { AppContext } from '../../service/context';
import { ExceptionService } from '../../service/exceptions';
import { FastifyInstance } from 'fastify';
import { dayKey } from '../../util/dates';
import { requireRole } from '../auth';

/**
 * The morning board. This is the first thing the office opens and it is the
 * only endpoint anybody has asked to be faster, so it takes a flag to leave the
 * sizing sweep out: sizing walks every tank through a vaporization calculation
 * and it is the only part of this that costs anything.
 */
export function registerExceptionRoutes(app: FastifyInstance, context: AppContext): void {
  const exceptions = new ExceptionService(context);

  app.get<{
    Querystring: { asOf?: string; dueWindowDays?: string; includeSizing?: string; kind?: string };
  }>('/exceptions', { preHandler: requireRole('office', 'job') }, async (request) => {
    const report = exceptions.report({
      ...(request.query.asOf ? { asOf: dayKey(request.query.asOf) } : {}),
      ...(request.query.dueWindowDays
        ? { dueWindowDays: Number(request.query.dueWindowDays) }
        : {}),
      includeSizing: request.query.includeSizing === 'true',
    });
    if (!request.query.kind) {
      return report;
    }
    const wanted = new Set(request.query.kind.split(',').map((value) => value.trim()));
    const filtered = report.exceptions.filter((entry) => wanted.has(entry.kind));
    return {
      ...report,
      exceptions: filtered,
      today: filtered.filter((entry) => entry.urgency === 'today').length,
    };
  });
}
