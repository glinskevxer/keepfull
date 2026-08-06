import { AppContext, currentDay } from '../../service/context';
import { ComplianceService } from '../../service/compliance';
import { FastifyInstance } from 'fastify';
import { PriceChangeService } from '../../service/price-changes';
import { PricingService } from '../../service/pricing';
import { addDays, dayKey } from '../../util/dates';
import { makeSchedule } from '../../core/pricing';
import { mills } from '../../util/money';
import { parseOrThrow } from '../validate';
import { priceQuerySchema } from '../schema';
import { callerOf } from '../caller';
import { requireRole } from '../auth';

/**
 * The two boards the office keeps open all day: what has to be dealt with, and
 * what a fill is going to cost. Neither writes anything except the price
 * schedule endpoint, which is the one thing on here anybody edits.
 */
export function registerOfficeRoutes(app: FastifyInstance, context: AppContext): void {
  const compliance = new ComplianceService(context);
  const pricing = new PricingService(context);
  const priceChanges = new PriceChangeService(context);

  app.get<{ Querystring: { asOf?: string; noticeDays?: string } }>(
    '/compliance',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const report = compliance.report({
        ...(request.query.asOf ? { asOf: dayKey(request.query.asOf) } : {}),
        ...(request.query.noticeDays
          ? { window: { noticeDays: Number(request.query.noticeDays) } }
          : {}),
      });
      return report;
    },
  );

  app.get<{ Params: { id: string }; Querystring: { on?: string } }>(
    '/tanks/:id/can-fill',
    { preHandler: requireRole('office', 'driver') },
    async (request) =>
      compliance.canFill(
        request.params.id,
        request.query.on ? dayKey(request.query.on) : undefined,
      ),
  );

  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/compliance/interruptions',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const to = request.query.to ? dayKey(request.query.to) : currentDay(context);
      const from = request.query.from ? dayKey(request.query.from) : addDays(to, -365);
      const records = compliance.interruptions(from, to);
      return {
        from,
        to,
        interruptions: records,
        outstanding: records.filter((record) => !record.cleared).length,
      };
    },
  );

  app.get('/compliance/grounded', { preHandler: requireRole('office', 'job') }, async () => ({
    grounded: compliance.groundedTrucks(),
  }));

  app.get('/prices/quote', { preHandler: requireRole('office') }, async (request) => {
    const query = parseOrThrow(priceQuerySchema, request.query);
    return {
      quote: pricing.priceFor({
        customerId: query.customerId,
        gallons: query.gallons,
        ...(query.on ? { on: dayKey(query.on) } : {}),
        ...(query.taxPercent === undefined ? {} : { taxPercent: query.taxPercent }),
        ...(query.ignoreLock === undefined ? {} : { ignoreLock: query.ignoreLock }),
      }),
    };
  });

  app.get<{ Querystring: { rateClass?: string } }>(
    '/prices/schedules',
    { preHandler: requireRole('office') },
    async (request) => ({
      schedules: context.pricing.listSchedules(
        request.query.rateClass ? { rateClass: request.query.rateClass as never } : {},
      ),
    }),
  );

  app.post<{
    Body: {
      rateClass: string;
      effectiveFrom: string;
      adderPerGallon?: number;
      tiers: { fromGallons: number; pricePerGallon: number }[];
    };
  }>('/prices/schedules', { preHandler: requireRole('office') }, async (request, reply) => {
    const body = request.body;
    const schedule = makeSchedule({
      id: context.ids.next('prc'),
      rateClass: body.rateClass as never,
      effectiveFrom: dayKey(body.effectiveFrom),
      ...(body.adderPerGallon ? { adderPerGallon: mills(body.adderPerGallon) } : {}),
      tiers: body.tiers.map((tier) => ({
        fromGallons: tier.fromGallons,
        pricePerGallon: mills(tier.pricePerGallon),
      })),
    });
    context.pricing.saveSchedule(schedule);
    reply.code(201);
    return { schedule };
  });

  app.get('/prices/committed', { preHandler: requireRole('office') }, async () => ({
    gallons: pricing.committedGallons(),
  }));

  app.post<{
    Body: {
      deltaPerGallon: number;
      effectiveFrom: string;
      rateClasses?: string[];
      note?: string;
    };
  }>('/prices/move', { preHandler: requireRole('office') }, async (request, reply) => {
    const body = request.body;
    const result = priceChanges.apply(
      {
        deltaPerGallon: mills(body.deltaPerGallon),
        effectiveFrom: dayKey(body.effectiveFrom),
        ...(body.rateClasses ? { rateClasses: body.rateClasses as never } : {}),
        ...(body.note ? { note: body.note } : {}),
      },
      callerOf(request),
    );
    reply.code(201);
    return result;
  });

  app.get<{ Querystring: { deltaPerGallon?: string; season?: string } }>(
    '/prices/impact',
    { preHandler: requireRole('office') },
    async (request) => {
      const delta = mills(Number(request.query.deltaPerGallon ?? 0));
      const season = Number(request.query.season ?? currentDay(context).slice(0, 4)) - 1;
      return { deltaPerGallon: delta, season, impact: priceChanges.impact(delta, season) };
    },
  );
}
