import { get } from 'node:http';

/**
 * The container health check.
 *
 * A shell out to curl would be one more thing in the image and one more thing
 * to keep patched, and the image deliberately carries nothing but node. This
 * hits `/ready` rather than `/health`, because a process that is up but cannot
 * reach its database is not a process the load balancer should be sending
 * anything to.
 */

const TIMEOUT_MS = 4000;

export function probe(
  port = Number(process.env.PORT ?? 8080),
  host = '127.0.0.1',
): Promise<number> {
  return new Promise((resolve) => {
    const request = get({ host, port, path: '/ready', timeout: TIMEOUT_MS }, (response) => {
      // Drain the body, otherwise the socket stays open and the probe hangs
      // until the timeout even though the answer already arrived.
      response.resume();
      response.on('end', () => resolve(response.statusCode === 200 ? 0 : 1));
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(1);
    });
    request.on('error', () => resolve(1));
  });
}

if (require.main === module) {
  probe()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
