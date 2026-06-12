import { AppContext, currentDay } from '../../service/context';
import { FastifyInstance } from 'fastify';
import { addDays, dayKey } from '../../util/dates';
import { fahrenheit } from '../../core/units';
import { defined, flag } from '../query-params';
import { makeStation } from '../../model/station';
import { normalsSchema, observationBatchSchema } from '../schema';
import { parseOrThrow } from '../validate';
import { requireRole } from '../auth';

/**
 * Weather.
 *
 * Observations arrive in batches from a nightly pull, and the batch is
 * deliberately idempotent: the same day sent twice overwrites rather than
 * duplicating, because the weather service revises yesterday's low about once a
 * fortnight and the pull is simplest if it just re-sends the last week every
 * night.
 */
export function registerWeatherRoutes(app: FastifyInstance, context: AppContext): void {
  app.get<{ Querystring: { activeOnly?: string } }>(
    '/stations',
    { preHandler: requireRole('office', 'job') },
    async (request) => ({
      stations: context.weather
        .listStations(defined({ activeOnly: flag(request.query.activeOnly) }))
        .map((station) => ({
          ...station,
          observations: context.weather.countObservations(station.id),
          latestObservation: context.weather.latestObservationDay(station.id) ?? null,
        })),
    }),
  );

  app.post<{
    Body: {
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      elevationFeet: number;
      baseTemperature?: number;
    };
  }>('/stations', { preHandler: requireRole('office') }, async (request, reply) => {
    const station = makeStation(request.body);
    context.weather.saveStation(station);
    reply.code(201);
    return { station };
  });

  app.post('/observations', { preHandler: requireRole('job', 'office') }, async (request) => {
    const body = parseOrThrow(observationBatchSchema, request.body);
    context.weather.getStation(body.stationId);
    const recordedAt = context.clock();
    let written = 0;
    for (const observation of body.observations) {
      if (observation.low > observation.high) {
        continue;
      }
      context.weather.recordObservation(
        body.stationId,
        {
          day: dayKey(observation.day),
          high: fahrenheit(observation.high),
          low: fahrenheit(observation.low),
        },
        recordedAt,
      );
      written += 1;
    }
    context.logger.info('took a weather batch', {
      stationId: body.stationId,
      offered: body.observations.length,
      written,
    });
    return {
      stationId: body.stationId,
      offered: body.observations.length,
      written,
      rejected: body.observations.length - written,
      latestObservation: context.weather.latestObservationDay(body.stationId) ?? null,
    };
  });

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/stations/:id/degree-days',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const to = request.query.to ? dayKey(request.query.to) : currentDay(context);
      const from = request.query.from ? dayKey(request.query.from) : addDays(to, -30);
      const ledger = context.weather.loadLedger(request.params.id, from, to);
      return {
        stationId: request.params.id,
        from,
        to,
        total: ledger.accumulate(from, to),
        missing: ledger.missing(from, to),
        days: ledger.days().map((day) => ({
          day,
          heating: ledger.get(day)?.heating ?? 0,
          mean: ledger.get(day)?.mean ?? null,
        })),
      };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/stations/:id/normals',
    { preHandler: requireRole('office') },
    async (request) => {
      context.weather.getStation(request.params.id);
      const body = parseOrThrow(normalsSchema, request.body);
      for (const entry of body.normals) {
        context.weather.saveNormal(request.params.id, entry.monthDay, entry.heating);
      }
      return {
        stationId: request.params.id,
        stored: context.weather.loadNormals(request.params.id).size,
      };
    },
  );
}
