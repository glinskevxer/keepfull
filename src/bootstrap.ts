import { AppContext, buildContext } from './service/context';
import { Db, closeDatabase, openDatabase } from './db/connection';
import { Logger } from './util/logger';
import { MIGRATIONS } from './db/migrations';
import { Settings } from './config/env';
import { migrate, pendingMigrations } from './db/migrate';

/**
 * Everything that has to happen before the first request, in one place, so the
 * server, the cli and the nightly jobs all come up the same way.
 *
 * Migrations run at start up rather than as a separate deploy step. There is
 * one process on one machine writing one file; a migration gate that has to be
 * remembered separately is a step somebody forgets at half past six on a cold
 * morning.
 */

export interface Runtime {
  readonly context: AppContext;
  readonly db: Db;
  readonly logger: Logger;
  shutdown(): void;
}

export interface BootOptions {
  /** Skip migrating, for a read only process attached to a live file. */
  readonly skipMigrations?: boolean;
  readonly clock?: () => Date;
}

export function boot(settings: Settings, options: BootOptions = {}): Runtime {
  const logger = new Logger({ level: settings.logLevel });
  const db = openDatabase(settings.databasePath);

  if (!options.skipMigrations) {
    const pending = pendingMigrations(db, MIGRATIONS);
    if (pending.length > 0) {
      logger.info('migrating the database', {
        pending: pending.length,
        to: pending[pending.length - 1]?.version ?? 0,
      });
      migrate(db, MIGRATIONS, { logger });
    }
  }

  const context = buildContext(db, {
    logger,
    ...(options.clock ? { clock: options.clock } : {}),
  });

  return {
    context,
    db,
    logger,
    shutdown() {
      closeDatabase(db);
    },
  };
}
