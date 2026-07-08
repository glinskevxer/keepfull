import { AppContext, currentDay } from '../../service/context';
import { FastifyInstance } from 'fastify';
import { DriverDayService } from '../../service/driver-day';
import { ReportService } from '../../service/reports';
import { addDays, dayKey, heatingSeason } from '../../util/dates';
import { requireRole } from '../auth';

/**
 * Reports. Every one of these takes a day range and defaults it to something
 * sensible, because the office links to them from a dashboard with no dates on
 * it and then narrows down from there.
 */
export function registerReportRoutes(app: FastifyInstance, context: AppContext): void {
  const reports = new ReportService(context);
  const driverDays = new DriverDayService(context);

  const range = (query: { from?: string; to?: string }, defaultDays: number) => {
    const to = query.to ? dayKey(query.to) : currentDay(context);
    const from = query.from ? dayKey(query.from) : addDays(to, -defaultDays);
    return { from, to };
  };

  app.get<{ Querystring: { from?: string; to?: string; by?: string } }>(
    '/reports/gallons',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const { from, to } = range(request.query, 365);
      const by = request.query.by === 'season' ? 'season' : 'month';
      return {
        from,
        to,
        by,
        periods:
          by === 'season' ? reports.gallonsBySeason(from, to) : reports.gallonsByMonth(from, to),
      };
    },
  );

  app.get<{ Querystring: { stationId?: string; seasons?: string } }>(
    '/reports/seasons',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const stationId = request.query.stationId ?? context.weather.listStations()[0]?.id;
      if (!stationId) {
        return { stationId: null, seasons: [] };
      }
      const current = heatingSeason(currentDay(context));
      const seasons = request.query.seasons
        ? request.query.seasons.split(',').map((value) => Number(value.trim()))
        : [current - 2, current - 1, current];
      return { stationId, seasons: reports.seasonComparison(stationId, seasons) };
    },
  );

  app.get<{ Querystring: { from?: string; to?: string; truckId?: string } }>(
    '/reports/meter-accuracy',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const { from, to } = range(request.query, 90);
      return {
        from,
        to,
        ...reports.deliveryAccuracy(from, to, request.query.truckId),
      };
    },
  );

  app.get<{ Querystring: { on?: string; driverId?: string } }>(
    '/reports/driver-day',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const on = request.query.on ? dayKey(request.query.on) : currentDay(context);
      const drivers = request.query.driverId
        ? [driverDays.forDriver(request.query.driverId, on)]
        : driverDays.forDay(on);
      return { on, drivers };
    },
  );

  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/reports/routes',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const { from, to } = range(request.query, 30);
      return { from, to, ...reports.routeEfficiency(from, to) };
    },
  );
}
