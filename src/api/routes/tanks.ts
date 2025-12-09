import { Appliance, Tank, TankOwner, TankSetting, makeTank } from '../../model/tank';
import { AppContext, currentDay } from '../../service/context';
import { FastifyInstance } from 'fastify';
import { ReadingSource, makeReading } from '../../model/reading';
import { createTankSchema, recordReadingSchema } from '../schema';
import { dayKey } from '../../util/dates';
import { gallonsAt, roomToFill } from '../../core/tank-math';
import { parseOrThrow } from '../validate';
import { requireRole } from '../auth';

/**
 * Tanks and the gauge readings against them.
 *
 * The reading endpoint is the busiest thing on this server by a wide margin,
 * because the monitor vendor pushes every tank it watches once a day, so it
 * takes a batch and it never does more work than writing rows.
 */

function present(tank: Tank): Record<string, unknown> {
  return {
    id: tank.id,
    customerId: tank.customerId,
    serialNumber: tank.serialNumber,
    waterCapacity: tank.waterCapacity,
    owner: tank.owner,
    setting: tank.setting,
    fillLimit: tank.geometry.fillLimit,
    reservePercent: tank.geometry.reservePercent,
    appliances: tank.appliances,
    installedOn: tank.installedOn,
    removedOn: tank.removedOn ?? null,
    monitorId: tank.monitorId ?? null,
    lastLeakCheckOn: tank.lastLeakCheckOn ?? null,
  };
}

export function registerTankRoutes(app: FastifyInstance, context: AppContext): void {
  app.get<{ Querystring: { customerId?: string; inServiceOnly?: string } }>(
    '/tanks',
    { preHandler: requireRole('office', 'driver', 'job') },
    async (request) => {
      const tanks = context.tanks.list({
        ...(request.query.customerId ? { customerId: request.query.customerId } : {}),
        ...(request.query.inServiceOnly === 'true' ? { inServiceOnly: true } : {}),
      });
      return { tanks: tanks.map(present) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/tanks/:id',
    { preHandler: requireRole('office', 'driver', 'job') },
    async (request) => {
      const tank = context.tanks.get(request.params.id);
      const reading = context.readings.latestFor(tank.id, { measuredOnly: true });
      return {
        tank: present(tank),
        lastReading: reading
          ? {
              takenOn: reading.takenOn,
              gauge: reading.gauge,
              source: reading.source,
              gallons: gallonsAt(tank.geometry, reading.gauge),
              roomToFill: roomToFill(tank.geometry, reading.gauge),
            }
          : null,
        lastDelivery: context.deliveries.lastDeliveryFor(tank.id) ?? null,
      };
    },
  );

  app.post('/tanks', { preHandler: requireRole('office') }, async (request, reply) => {
    const body = parseOrThrow(createTankSchema, request.body);
    context.customers.get(body.customerId);
    const tank = makeTank({
      id: context.ids.next('tnk'),
      customerId: body.customerId,
      serialNumber: body.serialNumber,
      waterCapacity: body.waterCapacity,
      owner: body.owner as TankOwner,
      ...(body.setting ? { setting: body.setting as TankSetting } : {}),
      ...(body.fillLimit === undefined ? {} : { fillLimit: body.fillLimit }),
      ...(body.reservePercent === undefined ? {} : { reservePercent: body.reservePercent }),
      ...(body.appliances ? { appliances: body.appliances as Appliance[] } : {}),
      installedOn: body.installedOn,
      ...(body.monitorId ? { monitorId: body.monitorId } : {}),
      ...(body.notes ? { notes: body.notes } : {}),
    });
    context.tanks.insert(tank);
    reply.code(201);
    return { tank: present(tank) };
  });

  app.post<{ Params: { id: string }; Body: { on?: string } }>(
    '/tanks/:id/leak-check',
    { preHandler: requireRole('office', 'driver') },
    async (request) => {
      const on = request.body?.on ? dayKey(request.body.on) : currentDay(context);
      context.tanks.recordLeakCheck(request.params.id, on);
      return { tank: present(context.tanks.get(request.params.id)) };
    },
  );

  app.post<{ Params: { id: string }; Body: { on: string } }>(
    '/tanks/:id/remove',
    { preHandler: requireRole('office') },
    async (request) => {
      context.tanks.remove(request.params.id, dayKey(request.body.on));
      return { tank: present(context.tanks.get(request.params.id)) };
    },
  );

  app.post(
    '/readings',
    { preHandler: requireRole('office', 'driver', 'monitor') },
    async (request, reply) => {
      const body = parseOrThrow(recordReadingSchema, request.body);
      context.tanks.get(body.tankId);
      const reading = makeReading({
        id: context.ids.next('rdg'),
        tankId: body.tankId,
        takenOn: body.takenOn,
        gauge: body.gauge,
        source: body.source as ReadingSource,
        ...(body.monitorId ? { monitorId: body.monitorId } : {}),
        ...(body.note ? { note: body.note } : {}),
      });
      context.readings.record(reading);
      reply.code(201);
      return { reading };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string; limit?: string } }>(
    '/tanks/:id/readings',
    { preHandler: requireRole('office', 'driver', 'job') },
    async (request) => {
      context.tanks.get(request.params.id);
      return {
        readings: context.readings.list({
          tankId: request.params.id,
          ...(request.query.from ? { from: dayKey(request.query.from) } : {}),
          ...(request.query.to ? { to: dayKey(request.query.to) } : {}),
          limit: request.query.limit ? Number(request.query.limit) : 60,
        }),
      };
    },
  );
}
