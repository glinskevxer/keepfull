import { AppContext } from '../../service/context';
import { DispatchService } from '../../service/dispatch';
import { FastifyInstance } from 'fastify';
import { InvalidInputError } from '../../core/errors';
import { Point } from '../../core/route/distance';
import { Route } from '../../model/route';
import { RoutingService } from '../../service/routing';
import { commitPlanSchema, dispatchQuerySchema, settleStopSchema } from '../schema';
import { dayKey } from '../../util/dates';
import { defined, flag, optionalDay, optionalText } from '../query-params';
import { parseOrThrow } from '../validate';
import { requireRole } from '../auth';

/**
 * The dispatch board.
 *
 * Planning and committing are separate calls on purpose. The dispatcher looks
 * at the plan, argues with it, moves a stop or two, and only then commits. A
 * single endpoint that planned and saved in one go would mean the only way to
 * see tomorrow was to create it.
 */

function presentRoute(route: Route): Record<string, unknown> {
  return {
    id: route.id,
    truckId: route.truckId,
    driverId: route.driverId ?? null,
    runOn: route.runOn,
    status: route.status,
    plannedGallons: route.plannedGallons,
    plannedMiles: route.plannedMiles,
    stops: route.stops.map((stop) => ({
      id: stop.id,
      position: stop.position,
      tankId: stop.tankId,
      customerId: stop.customerId,
      plannedGallons: stop.plannedGallons,
      outcome: stop.outcome,
      deliveryId: stop.deliveryId ?? null,
      note: stop.note ?? null,
    })),
  };
}

export function registerDispatchRoutes(
  app: FastifyInstance,
  context: AppContext,
  yard: Point,
): void {
  const dispatch = new DispatchService(context, yard);
  const routing = new RoutingService(context);

  app.get('/dispatch/plan', { preHandler: requireRole('office') }, async (request) => {
    const query = parseOrThrow(dispatchQuerySchema, request.query);
    const plan = dispatch.plan({
      ...(query.asOf ? { asOf: dayKey(query.asOf) } : {}),
      ...(query.windowDays === undefined ? {} : { windowDays: query.windowDays }),
      ...(query.maximumStopsPerTruck === undefined
        ? {}
        : { maximumStopsPerTruck: query.maximumStopsPerTruck }),
      ...(query.returnToYard === undefined ? {} : { returnToYard: query.returnToYard }),
    });
    return {
      day: plan.day,
      routes: plan.plan.routes.map((route) => ({
        truckId: route.truckId,
        plannedGallons: Math.round(route.plannedGallons * 10) / 10,
        miles: Math.round(route.miles * 10) / 10,
        utilisation: Math.round(route.utilisation * 1000) / 1000,
        stops: route.stops.map((stop) => ({
          tankId: stop.tankId,
          gallons: stop.gallons,
          urgency: stop.urgency,
          overdue: stop.overdue ?? false,
        })),
      })),
      deferred: plan.plan.deferred.map((entry) => ({
        tankId: entry.stop.tankId,
        gallons: entry.stop.gallons,
        reason: entry.reason,
      })),
      skipped: plan.skipped,
    };
  });

  app.post('/dispatch/commit', { preHandler: requireRole('office') }, async (request, reply) => {
    const query = parseOrThrow(dispatchQuerySchema, request.query);
    const body = parseOrThrow(commitPlanSchema, request.body ?? {});
    const plan = dispatch.plan({
      ...(query.asOf ? { asOf: dayKey(query.asOf) } : {}),
      ...(query.windowDays === undefined ? {} : { windowDays: query.windowDays }),
    });
    const routes = routing.commit(plan, {
      ...(body.runOn ? { runOn: dayKey(body.runOn) } : {}),
      ...(body.drivers ? { drivers: body.drivers } : {}),
      ...(body.replaceExisting === undefined ? {} : { replaceExisting: body.replaceExisting }),
    });
    reply.code(201);
    return { routes: routes.map(presentRoute) };
  });

  app.get<{ Querystring: { runOn?: string; truckId?: string; openOnly?: string } }>(
    '/routes',
    { preHandler: requireRole('office', 'driver', 'job') },
    async (request) => ({
      routes: context.routes
        .list(
          defined({
            runOn: optionalDay(request.query.runOn),
            truckId: optionalText(request.query.truckId),
            openOnly: flag(request.query.openOnly),
          }),
        )
        .map(presentRoute),
    }),
  );

  app.get<{ Params: { id: string } }>(
    '/routes/:id',
    { preHandler: requireRole('office', 'driver') },
    async (request) => ({ route: presentRoute(context.routes.get(request.params.id)) }),
  );

  app.post<{ Params: { id: string }; Body: { driverId?: string } }>(
    '/routes/:id/release',
    { preHandler: requireRole('office') },
    async (request) => ({
      route: presentRoute(routing.release(request.params.id, request.body?.driverId)),
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/routes/:id/stops',
    { preHandler: requireRole('office', 'driver') },
    async (request) => {
      const body = parseOrThrow(settleStopSchema, request.body);
      if (body.outcome === 'delivered') {
        if (!body.deliveryId) {
          throw new InvalidInputError('a delivered stop has to name its ticket');
        }
        routing.recordDelivery(request.params.id, body.tankId, body.deliveryId);
      } else {
        routing.missed(request.params.id, body.tankId, body.outcome, body.note);
      }
      return { route: presentRoute(context.routes.get(request.params.id)) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/routes/:id/close',
    { preHandler: requireRole('office', 'driver') },
    async (request) => ({ route: presentRoute(routing.close(request.params.id)) }),
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/routes/:id/cancel',
    { preHandler: requireRole('office') },
    async (request) => ({
      route: presentRoute(
        routing.cancel(request.params.id, request.body?.reason ?? 'no reason given'),
      ),
    }),
  );
}
