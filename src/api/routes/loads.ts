import { AppContext, currentDay } from '../../service/context';
import { FastifyInstance } from 'fastify';
import { ReconciliationService } from '../../service/reconciliation';
import { addDays, dayKey } from '../../util/dates';
import { makeTruckLoad } from '../../model/truck-load';
import { requireRole } from '../auth';

/**
 * Loads and the reconciliation built on them. The plant records a load when the
 * truck pulls out and closes it when the truck comes back, which is two calls
 * because between them the driver is on the road with no signal.
 */
export function registerLoadRoutes(app: FastifyInstance, context: AppContext): void {
  const reconciliation = new ReconciliationService(context);

  app.post<{
    Body: {
      truckId: string;
      driverId?: string;
      loadedOn?: string;
      plantGross: number;
      plantTemperature: number;
      meterStart: number;
      note?: string;
    };
  }>('/loads', { preHandler: requireRole('office', 'driver') }, async (request, reply) => {
    const body = request.body;
    context.fleet.getTruck(body.truckId);
    const loadedOn = body.loadedOn ? dayKey(body.loadedOn) : currentDay(context);
    const load = makeTruckLoad({
      id: context.ids.next('ld'),
      truckId: body.truckId,
      ...(body.driverId ? { driverId: body.driverId } : {}),
      loadedOn,
      sequence: context.loads.nextSequence(body.truckId, loadedOn),
      plantGross: body.plantGross,
      plantTemperature: body.plantTemperature,
      meterStart: body.meterStart,
      ...(body.note ? { note: body.note } : {}),
    });
    context.loads.insert(load);
    reply.code(201);
    return { load };
  });

  app.post<{ Params: { id: string }; Body: { meterEnd: number } }>(
    '/loads/:id/close',
    { preHandler: requireRole('office', 'driver') },
    async (request) => ({
      load: context.loads.closeShift(request.params.id, request.body.meterEnd),
    }),
  );

  app.get<{ Querystring: { truckId?: string; from?: string; to?: string; openOnly?: string } }>(
    '/loads',
    { preHandler: requireRole('office', 'job') },
    async (request) => ({
      loads: context.loads.list({
        ...(request.query.truckId ? { truckId: request.query.truckId } : {}),
        ...(request.query.from ? { from: dayKey(request.query.from) } : {}),
        ...(request.query.to ? { to: dayKey(request.query.to) } : {}),
        ...(request.query.openOnly === 'true' ? { openOnly: true } : {}),
      }),
    }),
  );

  app.get<{ Querystring: { day?: string } }>(
    '/reconciliation',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const day = request.query.day ? dayKey(request.query.day) : currentDay(context);
      const shifts = reconciliation.forDay(day);
      return {
        day,
        shifts,
        outOfTolerance: shifts.filter((shift) => !shift.withinTolerance).length,
      };
    },
  );

  app.get<{ Params: { truckId: string }; Querystring: { day?: string } }>(
    '/reconciliation/:truckId',
    { preHandler: requireRole('office', 'job') },
    async (request) => ({
      shift: reconciliation.forShift(
        request.params.truckId,
        request.query.day ? dayKey(request.query.day) : currentDay(context),
      ),
    }),
  );

  app.get<{ Params: { truckId: string }; Querystring: { from?: string; to?: string } }>(
    '/reconciliation/:truckId/drift',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const to = request.query.to ? dayKey(request.query.to) : currentDay(context);
      const from = request.query.from ? dayKey(request.query.from) : addDays(to, -30);
      return { drift: reconciliation.drift(request.params.truckId, from, to) };
    },
  );
}
