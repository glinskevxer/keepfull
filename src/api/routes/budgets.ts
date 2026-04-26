import { AppContext, currentDay } from '../../service/context';
import { BudgetService } from '../../service/budgets';
import { FastifyInstance } from 'fastify';
import { cents, mills } from '../../util/money';
import { dayKey } from '../../util/dates';
import { requireRole } from '../auth';

/**
 * Budget plans. Everything that changes money here is office only, including
 * recording a payment, because a driver taking a cheque at the door is not a
 * flow this dealer has and adding it by accident would be worse than not having
 * it at all.
 */
export function registerBudgetRoutes(app: FastifyInstance, context: AppContext): void {
  const budgets = new BudgetService(context);

  app.get<{ Querystring: { customerId?: string; season?: string; status?: string } }>(
    '/budgets',
    { preHandler: requireRole('office') },
    async (request) => ({
      plans: context.budgets.list({
        ...(request.query.customerId ? { customerId: request.query.customerId } : {}),
        ...(request.query.season ? { season: Number(request.query.season) } : {}),
        ...(request.query.status ? { status: request.query.status as never } : {}),
      }),
    }),
  );

  app.get<{ Params: { id: string } }>(
    '/budgets/:id',
    { preHandler: requireRole('office') },
    async (request) => ({
      plan: context.budgets.get(request.params.id),
      health: budgets.health(request.params.id),
    }),
  );

  app.post<{
    Body: {
      customerId: string;
      season?: number;
      startOn?: string;
      openingBalance?: number;
      cushionPercent?: number;
      instalments?: number;
      pricePerGallon?: number;
    };
  }>('/budgets', { preHandler: requireRole('office') }, async (request, reply) => {
    const body = request.body;
    const plan = budgets.create({
      customerId: body.customerId,
      ...(body.season === undefined ? {} : { season: body.season }),
      ...(body.startOn ? { startOn: dayKey(body.startOn) } : {}),
      ...(body.openingBalance === undefined ? {} : { openingBalance: cents(body.openingBalance) }),
      ...(body.cushionPercent === undefined ? {} : { cushionPercent: body.cushionPercent }),
      ...(body.instalments === undefined ? {} : { instalments: body.instalments }),
      ...(body.pricePerGallon === undefined ? {} : { pricePerGallon: mills(body.pricePerGallon) }),
    });
    reply.code(201);
    return { plan };
  });

  app.post<{ Params: { id: string }; Body: { number: number; on?: string; amount: number } }>(
    '/budgets/:id/payments',
    { preHandler: requireRole('office') },
    async (request) => ({
      plan: context.budgets.recordPayment(
        request.params.id,
        request.body.number,
        request.body.on ? dayKey(request.body.on) : currentDay(context),
        cents(request.body.amount),
      ),
    }),
  );

  app.post<{ Params: { id: string }; Body: { on?: string } }>(
    '/budgets/:id/settle',
    { preHandler: requireRole('office') },
    async (request) =>
      budgets.settle(request.params.id, request.body?.on ? dayKey(request.body.on) : undefined),
  );

  app.post<{ Params: { id: string } }>(
    '/budgets/:id/cancel',
    { preHandler: requireRole('office') },
    async (request) => ({ plan: context.budgets.cancel(request.params.id) }),
  );

  app.get<{ Querystring: { on?: string } }>(
    '/budgets/at-risk',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const plans = budgets.atRisk(request.query.on ? dayKey(request.query.on) : undefined);
      return { count: plans.length, plans };
    },
  );

  app.get<{ Querystring: { on?: string } }>(
    '/budgets/overdue',
    { preHandler: requireRole('office', 'job') },
    async (request) => ({
      overdue: context.budgets.overdue(
        request.query.on ? dayKey(request.query.on) : currentDay(context),
      ),
    }),
  );
}
