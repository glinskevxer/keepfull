import { AppContext } from '../../service/context';
import { AuditService } from '../../service/audit';
import { FastifyInstance } from 'fastify';
import { SubjectKind } from '../../db/repo/audit-repo';
import { dayKey } from '../../util/dates';
import { requireRole } from '../auth';

/**
 * Reading the audit trail. There is no endpoint that writes one, because
 * everything that writes here does so as a side effect of the change it is
 * recording, and an endpoint that let a caller write an arbitrary entry would
 * make the whole trail worth less than nothing.
 */
export function registerAuditRoutes(app: FastifyInstance, context: AppContext): void {
  const audit = new AuditService(context);

  app.get<{
    Querystring: {
      subjectKind?: string;
      subjectId?: string;
      actor?: string;
      action?: string;
      from?: string;
      to?: string;
      limit?: string;
    };
  }>('/audit', { preHandler: requireRole('office') }, async (request) => ({
    entries: context.audit.list({
      ...(request.query.subjectKind
        ? { subjectKind: request.query.subjectKind as SubjectKind }
        : {}),
      ...(request.query.subjectId ? { subjectId: request.query.subjectId } : {}),
      ...(request.query.actor ? { actor: request.query.actor } : {}),
      ...(request.query.action ? { action: request.query.action } : {}),
      ...(request.query.from ? { from: dayKey(request.query.from) } : {}),
      ...(request.query.to ? { to: dayKey(request.query.to) } : {}),
      ...(request.query.limit ? { limit: Number(request.query.limit) } : {}),
    }),
  }));

  app.get<{ Params: { kind: string; id: string } }>(
    '/audit/:kind/:id',
    { preHandler: requireRole('office') },
    async (request) => ({
      subjectKind: request.params.kind,
      subjectId: request.params.id,
      history: audit.history(request.params.kind as SubjectKind, request.params.id),
    }),
  );
}
