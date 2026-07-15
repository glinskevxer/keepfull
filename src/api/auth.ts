import { FastifyReply, FastifyRequest } from 'fastify';
import { PermissionDeniedError } from '../core/errors';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Api keys, one per caller, checked against stored hashes.
 *
 * There are four callers and they are not people: the office screens, the
 * handhelds in the trucks, the tank monitor vendor pushing readings in, and the
 * nightly jobs. None of them logs in, none of them has a session, and none of
 * them is on the public internet. A key per caller with a role attached is the
 * whole of what this needs, and anything more would be theatre.
 *
 * Keys are held as sha256 hashes so a config dump does not hand somebody the
 * yard. The comparison is constant time because a comparison that returns early
 * on the first wrong byte leaks the key one character at a time to anybody
 * patient enough to measure it.
 */

export type Role = 'office' | 'driver' | 'monitor' | 'job' | 'admin';

export const ROLES: readonly Role[] = ['office', 'driver', 'monitor', 'job', 'admin'];

export interface ApiCaller {
  readonly name: string;
  readonly role: Role;
}

export interface KeyRecord extends ApiCaller {
  /** Lowercase hex sha256 of the key. */
  readonly keyHash: string;
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function makeKeyRecord(name: string, role: Role, key: string): KeyRecord {
  if (!ROLES.includes(role)) {
    throw new Error(`"${role}" is not a role`);
  }
  if (key.length < 24) {
    throw new Error('an api key has to be at least twenty four characters');
  }
  return { name, role, keyHash: hashKey(key) };
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export class KeyRing {
  constructor(private readonly records: readonly KeyRecord[]) {}

  get size(): number {
    return this.records.length;
  }

  resolve(key: string | undefined): ApiCaller | undefined {
    if (!key) {
      return undefined;
    }
    const hash = hashKey(key);
    for (const record of this.records) {
      if (sameHash(record.keyHash, hash)) {
        return { name: record.name, role: record.role };
      }
    }
    return undefined;
  }
}

/** Admin can do anything. Otherwise the role has to be on the list. */
export function allows(caller: ApiCaller, roles: readonly Role[]): boolean {
  return caller.role === 'admin' || roles.includes(caller.role);
}

export function readKey(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  const direct = request.headers['x-api-key'];
  return typeof direct === 'string' ? direct : undefined;
}

/**
 * Paths anybody may reach: the balancer has no key, and neither does the
 * scraper. Every monitoring setup here that has carried a credential has
 * eventually had it expire quietly and the alerting go dark with it.
 */
const OPEN_PATHS = new Set(['/', '/health', '/ready', '/metrics']);

export function authenticate(keyRing: KeyRing) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const path = request.url.split('?')[0] ?? request.url;
    if (OPEN_PATHS.has(path)) {
      return;
    }
    const caller = keyRing.resolve(readKey(request));
    if (!caller) {
      reply.code(401).send({ code: 'permission_denied', message: 'that key is not one of ours' });
      return;
    }
    request.caller = caller;
  };
}

/** Guards one route. Throws rather than replying so the error handler shapes it. */
export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest): Promise<void> => {
    const caller = request.caller;
    if (!caller || !allows(caller, roles)) {
      throw new PermissionDeniedError(`${request.method.toLowerCase()} ${request.url}`);
    }
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    caller?: ApiCaller;
  }
}
