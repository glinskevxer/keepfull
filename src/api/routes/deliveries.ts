import { AppContext } from '../../service/context';
import { Delivery, FillReason } from '../../model/delivery';
import { DeliveryService } from '../../service/deliveries';
import { FastifyInstance } from 'fastify';
import { PricingService } from '../../service/pricing';
import { dayKey } from '../../util/dates';
import { parseOrThrow } from '../validate';
import { postDeliverySchema } from '../schema';
import { requireRole } from '../auth';

/**
 * Delivery tickets.
 *
 * The handhelds post here at the end of a shift, usually a dozen at a time and
 * usually over the yard wifi from the parking lot, so each one is its own
 * request and a failure on one must not lose the other eleven. There is no
 * batch endpoint on purpose.
 */

function present(delivery: Delivery): Record<string, unknown> {
  return {
    id: delivery.id,
    ticketNumber: delivery.ticketNumber,
    customerId: delivery.customerId,
    tankId: delivery.tankId,
    deliveredOn: delivery.deliveredOn,
    gross: delivery.gross,
    net: delivery.net,
    meterTemperature: delivery.meterTemperature,
    gaugeBefore: delivery.gaugeBefore ?? null,
    gaugeAfter: delivery.gaugeAfter ?? null,
    reason: delivery.reason,
    status: delivery.status,
    driverId: delivery.driverId,
    truckId: delivery.truckId,
    notes: delivery.notes ?? null,
  };
}

export function registerDeliveryRoutes(app: FastifyInstance, context: AppContext): void {
  const deliveries = new DeliveryService(context);
  const pricing = new PricingService(context);

  app.post(
    '/deliveries',
    { preHandler: requireRole('office', 'driver') },
    async (request, reply) => {
      const body = parseOrThrow(postDeliverySchema, request.body);
      const who = {
        actor: request.caller?.name ?? 'unknown',
        ...(request.requestId ? { requestId: request.requestId } : {}),
      };
      const posted = deliveries.post(
        {
          id: context.ids.next('dlv'),
          ticketNumber: body.ticketNumber,
          customerId: body.customerId,
          tankId: body.tankId,
          deliveredOn: body.deliveredOn,
          gross: body.gross,
          meterTemperature: body.meterTemperature,
          ...(body.gaugeBefore === undefined ? {} : { gaugeBefore: body.gaugeBefore }),
          ...(body.gaugeAfter === undefined ? {} : { gaugeAfter: body.gaugeAfter }),
          ...(body.reason ? { reason: body.reason as FillReason } : {}),
          driverId: body.driverId,
          truckId: body.truckId,
          ...(body.notes ? { notes: body.notes } : {}),
        },
        {},
        who,
      );
      reply.code(201);
      return { delivery: present(posted.delivery), flags: posted.flags };
    },
  );

  app.get<{
    Querystring: {
      tankId?: string;
      customerId?: string;
      truckId?: string;
      from?: string;
      to?: string;
      postedOnly?: string;
      limit?: string;
    };
  }>('/deliveries', { preHandler: requireRole('office', 'job') }, async (request) => {
    const query = request.query;
    const rows = context.deliveries.list({
      ...(query.tankId ? { tankId: query.tankId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.truckId ? { truckId: query.truckId } : {}),
      ...(query.from ? { from: dayKey(query.from) } : {}),
      ...(query.to ? { to: dayKey(query.to) } : {}),
      ...(query.postedOnly === 'true' ? { postedOnly: true } : {}),
      limit: query.limit ? Number(query.limit) : 200,
    });
    return { deliveries: rows.map(present) };
  });

  app.get<{ Params: { id: string } }>(
    '/deliveries/:id',
    { preHandler: requireRole('office', 'driver', 'job') },
    async (request) => ({ delivery: present(context.deliveries.get(request.params.id)) }),
  );

  app.get<{ Params: { id: string }; Querystring: { taxPercent?: string } }>(
    '/deliveries/:id/price',
    { preHandler: requireRole('office') },
    async (request) => {
      const delivery = context.deliveries.get(request.params.id);
      const priced = pricing.priceFor({
        customerId: delivery.customerId,
        gallons: delivery.net,
        on: delivery.deliveredOn,
        ...(request.query.taxPercent === undefined
          ? {}
          : { taxPercent: Number(request.query.taxPercent) }),
      });
      return { price: priced };
    },
  );

  app.post<{ Params: { id: string }; Body: { note?: string } }>(
    '/deliveries/:id/void',
    { preHandler: requireRole('office') },
    async (request) => {
      const note = request.body?.note ?? 'voided from the office';
      const who = {
        actor: request.caller?.name ?? 'unknown',
        ...(request.requestId ? { requestId: request.requestId } : {}),
      };
      return { delivery: present(deliveries.void(request.params.id, note, who)) };
    },
  );

  app.get<{ Querystring: { from?: string; to?: string; truckId?: string } }>(
    '/deliveries/totals',
    { preHandler: requireRole('office', 'job') },
    async (request) => ({
      totals: context.deliveries.totals({
        ...(request.query.from ? { from: dayKey(request.query.from) } : {}),
        ...(request.query.to ? { to: dayKey(request.query.to) } : {}),
        ...(request.query.truckId ? { truckId: request.query.truckId } : {}),
      }),
    }),
  );
}
