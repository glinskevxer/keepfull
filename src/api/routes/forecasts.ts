import { AppContext, currentDay } from '../../service/context';
import { FastifyInstance } from 'fastify';
import { ForecastingService, TankForecast } from '../../service/forecasting';
import { countSkipsByReason, usableShare } from '../../core/fill-intervals';
import { addDays, dayKey } from '../../util/dates';
import { forecastQuerySchema } from '../schema';
import { parseOrThrow } from '../validate';
import { requireRole } from '../auth';
import { round } from '../../util/round';

/**
 * Forecasts.
 *
 * Every response here says how it was arrived at, not just what it concluded.
 * The office does not act on a projected reserve date without knowing whether
 * it came off six clean fills or two scrappy ones, and a screen that shows the
 * date alone gets trusted far more than it deserves.
 */

function present(result: TankForecast): Record<string, unknown> {
  return {
    tankId: result.tank.id,
    customerId: result.tank.customerId,
    startingPoint: result.startingPoint,
    model: {
      baseGallonsPerDay: round(result.model.baseGallonsPerDay, 4),
      weatherGallonsPerDegreeDay: round(result.model.weatherGallonsPerDegreeDay, 5),
      kFactor: result.model.kFactor === undefined ? null : round(result.model.kFactor, 2),
      intervalsUsed: result.model.intervalsUsed,
      intervalsRejected: result.model.intervalsRejected,
      fitQuality: round(result.model.fitQuality, 4),
    },
    evidence: {
      usableShare: round(usableShare(result.intervals), 4),
      skippedBy: countSkipsByReason(result.intervals),
    },
    reserveDay: result.forecast.reserveDay ?? null,
    outOfGasDay: result.forecast.outOfGasDay ?? null,
    lastActualWeatherDay: result.forecast.lastActualWeatherDay ?? null,
    horizonDays: result.forecast.horizonDays,
  };
}

export function registerForecastRoutes(app: FastifyInstance, context: AppContext): void {
  const forecasting = new ForecastingService(context);

  app.get<{ Params: { id: string } }>(
    '/tanks/:id/forecast',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const query = parseOrThrow(forecastQuerySchema, request.query);
      const result = forecasting.forTank(request.params.id, {
        ...(query.asOf ? { asOf: dayKey(query.asOf) } : {}),
        ...(query.horizonDays === undefined ? {} : { horizonDays: query.horizonDays }),
      });
      return { forecast: present(result) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/tanks/:id/forecast/days',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const query = parseOrThrow(forecastQuerySchema, request.query);
      const result = forecasting.forTank(request.params.id, {
        ...(query.asOf ? { asOf: dayKey(query.asOf) } : {}),
        ...(query.horizonDays === undefined ? {} : { horizonDays: query.horizonDays }),
      });
      return {
        tankId: result.tank.id,
        days: result.forecast.days.map((day) => ({
          day: day.day,
          degreeDays: round(day.degreeDays, 2),
          gallonsRemaining: round(day.gallonsRemaining, 2),
          gauge: round(day.gauge, 2),
          actualWeather: day.actualWeather,
        })),
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/tanks/:id/burn-model',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const { model, intervals } = forecasting.burnModel(request.params.id);
      return {
        tankId: request.params.id,
        model,
        intervals: intervals.intervals,
        skipped: intervals.skipped,
      };
    },
  );

  /** What the whole book is thought to be holding, for the buyer. */
  app.get('/forecasts/summary', { preHandler: requireRole('office', 'job') }, async (request) => {
    const query = parseOrThrow(forecastQuerySchema, request.query);
    const asOf = query.asOf ? dayKey(query.asOf) : currentDay(context);
    let forecast = 0;
    let unforecastable = 0;
    let dueInside14 = 0;
    let overdue = 0;
    for (const tank of context.tanks.list({ inServiceOnly: true })) {
      const result = forecasting.tryForTank(tank.id, { asOf });
      if (!result) {
        unforecastable += 1;
        continue;
      }
      forecast += 1;
      const reserveDay = result.forecast.reserveDay;
      if (reserveDay === undefined) {
        continue;
      }
      if (reserveDay <= asOf) {
        overdue += 1;
      } else if (reserveDay <= addDays(asOf, 14)) {
        dueInside14 += 1;
      }
    }
    return { asOf, forecast, unforecastable, dueInside14, overdue };
  });
}
