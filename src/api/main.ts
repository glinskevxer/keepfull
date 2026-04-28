import { boot } from '../bootstrap';
import { buildServer } from './server';
import { describeError } from '../core/errors';
import { describeSettings, loadSettings } from '../config/env';

/**
 * The process entry point.
 *
 * Shutdown matters more than start up here. The handhelds post tickets in a
 * burst at end of shift, and a deploy that drops a connection mid burst means a
 * driver has to key a ticket in twice. So the signals wait for whatever is in
 * flight before the database is closed.
 */

const SHUTDOWN_GRACE_MS = 10_000;

export async function main(): Promise<void> {
  const settings = loadSettings();
  const runtime = boot(settings);
  runtime.logger.info('starting up', describeSettings(settings));

  const app = buildServer({
    context: runtime.context,
    keyRing: settings.keyRing,
    yard: settings.yard,
    requestLogging: settings.requestLogging,
    ...(settings.requestsPerMinute === undefined
      ? {}
      : { requestsPerMinute: settings.requestsPerMinute }),
  });

  let closing = false;
  const stop = async (signal: string): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    runtime.logger.info('shutting down', { signal });
    const timer = setTimeout(() => {
      runtime.logger.warn('shutdown took too long, going anyway', { ms: SHUTDOWN_GRACE_MS });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    timer.unref();
    try {
      await app.close();
      runtime.shutdown();
      runtime.logger.info('stopped cleanly');
      process.exit(0);
    } catch (error) {
      runtime.logger.error('shutdown failed', { error: describeError(error) });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    runtime.logger.error('unhandled rejection', { error: describeError(reason) });
  });

  await app.listen({ port: settings.port, host: settings.host });
  runtime.logger.info('listening', { host: settings.host, port: settings.port });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${describeError(error)}\n`);
    process.exit(1);
  });
}
