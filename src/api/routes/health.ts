import { AppContext, currentDay } from '../../service/context';
import { DoctorService } from '../../service/doctor';
import { Settings } from '../../config/env';
import { FastifyInstance } from 'fastify';
import { MIGRATIONS } from '../../db/migrations';
import { currentVersion, isUpToDate } from '../../db/migrate';
import { buildInfo } from '../../version';
import { integrityCheck } from '../../db/connection';

/**
 * Two endpoints with different jobs. `/health` answers whether the process is
 * up, and the load balancer hits it every few seconds, so it does no work.
 * `/ready` answers whether the process can actually serve, which means touching
 * the database, and only the deploy script hits it.
 */
export function registerHealthRoutes(
  app: FastifyInstance,
  context: AppContext,
  settings?: Settings,
): void {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_request, reply) => {
    const schema = currentVersion(context.db);
    const migrated = isUpToDate(context.db, MIGRATIONS);
    const integrity = integrityCheck(context.db);
    const ready = migrated && integrity === 'ok';
    reply.code(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not ready',
      version: buildInfo().version,
      commit: buildInfo().commit,
      schemaVersion: schema,
      migrationsPending: MIGRATIONS.length - schema,
      integrity,
      today: currentDay(context),
    };
  });

  /**
   * The deploy check. This one does real work, so the balancer does not touch
   * it: it is what somebody runs after a deploy or a restore, and what the
   * office is told to look at when the forecasts seem wrong.
   *
   * Blocking findings are a 503, because a deployment that cannot forecast is
   * not one anything should be sending work to, even though the process is up
   * and every request would technically succeed.
   */
  app.get('/diagnose', async (_request, reply) => {
    const diagnosis = new DoctorService(context, settings).diagnose();
    reply.code(diagnosis.healthy ? 200 : 503);
    return diagnosis;
  });
}
