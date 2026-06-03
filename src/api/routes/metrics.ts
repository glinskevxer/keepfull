import { AppContext } from '../../service/context';
import { ExceptionService } from '../../service/exceptions';
import { FastifyInstance } from 'fastify';
import { ForecastingService } from '../../service/forecasting';
import { Registry } from '../../util/metrics';

/**
 * The scrape endpoint.
 *
 * The gauges are filled in here rather than being kept up to date as things
 * change, because they are all counts over the whole book and keeping a running
 * count correct through every path that can add or remove a tank is far more
 * work than counting them once a minute.
 *
 * It is deliberately not behind an api key. The scraper runs on the same
 * machine, there is nothing here a competitor would want, and every monitoring
 * setup that has had to carry a credential for this has eventually had the
 * credential expire quietly and the alerting go dark.
 */
export function registerMetricsRoutes(
  app: FastifyInstance,
  context: AppContext,
  registry: Registry,
): void {
  app.get('/metrics', async (_request, reply) => {
    const forecasting = new ForecastingService(context);
    const tanks = context.tanks.list({ inServiceOnly: true });
    registry.set('keepfull_tanks_in_service', tanks.length);
    registry.set(
      'keepfull_tanks_forecastable',
      tanks.filter((tank) => forecasting.tryForTank(tank.id) !== undefined).length,
    );

    const board = new ExceptionService(context).report();
    for (const urgency of ['today', 'this_week', 'this_month'] as const) {
      registry.set(
        'keepfull_exceptions_open',
        board.exceptions.filter((entry) => entry.urgency === urgency).length,
        { urgency },
      );
    }

    reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    return registry.render();
  });
}
