import { AppContext } from '../../service/context';
import { Appliance } from '../../model/tank';
import { FastifyInstance } from 'fastify';
import { SizingService } from '../../service/sizing';
import { fahrenheit, percent } from '../../core/units';
import { requireRole } from '../auth';

/**
 * Tank sizing. The service desk hits `/sizing/appliances` while somebody is on
 * the phone describing what they are putting in, and the book wide sweep runs
 * from the nightly job.
 */
export function registerSizingRoutes(app: FastifyInstance, context: AppContext): void {
  const sizing = new SizingService(context);

  const optionsFrom = (query: { ambient?: string; downTo?: string; diversity?: string }) => ({
    ...(query.ambient ? { ambient: fahrenheit(Number(query.ambient)) } : {}),
    ...(query.downTo ? { downToGauge: percent(Number(query.downTo)) } : {}),
    ...(query.diversity ? { diversity: Number(query.diversity) } : {}),
  });

  app.get<{
    Params: { id: string };
    Querystring: { ambient?: string; downTo?: string; diversity?: string };
  }>('/tanks/:id/sizing', { preHandler: requireRole('office', 'job') }, async (request) => ({
    sizing: sizing.forTank(request.params.id, optionsFrom(request.query)),
  }));

  app.get<{
    Querystring: { appliances?: string; ambient?: string; downTo?: string; diversity?: string };
  }>('/sizing/appliances', { preHandler: requireRole('office') }, async (request) => {
    const appliances = (request.query.appliances ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0) as Appliance[];
    return sizing.forAppliances(appliances, optionsFrom(request.query));
  });

  app.get<{ Querystring: { ambient?: string; downTo?: string } }>(
    '/sizing/undersized',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const verdicts = sizing.undersizedTanks(optionsFrom(request.query));
      return { count: verdicts.length, tanks: verdicts };
    },
  );
}
