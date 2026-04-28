import { FastifyReply, FastifyRequest } from 'fastify';
import { IdFactory } from '../util/ids';

/**
 * Every request carries an id, and every log line it produces carries the same
 * one.
 *
 * The reason is a specific afternoon. A driver reported a ticket that would not
 * post, the office reported the screen hanging, and the monitor vendor reported
 * timeouts, all inside ten minutes. Working out that those were one incident
 * and not three took most of a day, because nothing in the log tied a line to
 * the request that produced it.
 *
 * If the caller sends its own id we keep it, so the handheld's retry and the
 * server's log agree on what to call the thing.
 */

const HEADER = 'x-request-id';

/** Only accept an id that is safe to put in a log line and a header. */
const SAFE = /^[A-Za-z0-9_.:-]{1,64}$/;

export function readRequestId(request: FastifyRequest): string | undefined {
  const header = request.headers[HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && SAFE.test(value) ? value : undefined;
}

export function requestId(ids: IdFactory) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const id = readRequestId(request) ?? ids.next('req');
    request.requestId = id;
    reply.header(HEADER, id);
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    requestId?: string;
  }
}
