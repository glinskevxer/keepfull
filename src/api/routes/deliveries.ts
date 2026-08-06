import { AppContext } from '../../service/context';
import { Delivery, FillReason } from '../../model/delivery';
import { DeliveryService } from '../../service/deliveries';
import { FastifyInstance } from 'fastify';
import { PricingService } from '../../service/pricing';
import { defined, flag, optionalDay, optionalNumber, optionalText } from '../query-params';
import { parseOrThrow } from '../validate';
import { postDeliverySchema } from '../schema';
import { callerOf } from '../caller';
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
    const rows = context.deliveries.list(
      defined({
        tankId: optionalText(query.tankId),
        customerId: optionalText(query.customerId),
        truckId: optionalText(query.truckId),
        from: optionalDay(query.from),
        to: optionalDay(query.to),
        postedOnly: flag(query.postedOnly),
        limit: optionalNumber(query.limit) ?? 200,
      }),
    );
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
        ...defined({ taxPercent: optionalNumber(request.query.taxPercent) }),
      });
      return { price: priced };
    },
  );

  app.post<{ Params: { id: string }; Body: { note?: string } }>(
    '/deliveries/:id/void',
    { preHandler: requireRole('office') },
    async (request) => {
      const note = request.body?.note ?? 'voided from the office';
      return { delivery: present(deliveries.void(request.params.id, note, callerOf(request))) };
    },
  );

  app.get<{ Querystring: { from?: string; to?: string; truckId?: string } }>(
    '/deliveries/totals',
    { preHandler: requireRole('office', 'job') },
    async (request) => ({
      totals: context.deliveries.totals(
        defined({
          from: optionalDay(request.query.from),
          to: optionalDay(request.query.to),
          truckId: optionalText(request.query.truckId),
        }),
      ),
    }),
  );
}
