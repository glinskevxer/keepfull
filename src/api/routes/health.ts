import { AppContext, currentDay } from '../../service/context';
import { FastifyInstance } from 'fastify';
import { MIGRATIONS } from '../../db/migrations';
import { currentVersion, isUpToDate } from '../../db/migrate';
import { integrityCheck } from '../../db/connection';

/**
 * Two endpoints with different jobs. `/health` answers whether the process is
 * up, and the load balancer hits it every few seconds, so it does no work.
 * `/ready` answers whether the process can actually serve, which means touching
 * the database, and only the deploy script hits it.
 */
export function registerHealthRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_request, reply) => {
    const schema = currentVersion(context.db);
    const migrated = isUpToDate(context.db, MIGRATIONS);
    const integrity = integrityCheck(context.db);
    const ready = migrated && integrity === 'ok';
    reply.code(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not ready',
      schemaVersion: schema,
      migrationsPending: MIGRATIONS.length - schema,
      integrity,
      today: currentDay(context),
    };
  });
}
