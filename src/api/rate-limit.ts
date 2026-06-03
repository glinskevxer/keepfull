import { FastifyReply, FastifyRequest } from 'fastify';

/**
 * A fixed window limiter, per caller.
 *
 * There is one caller on this api that can hurt us and it is not an attacker,
 * it is the monitor vendor. Their export job retries on any non 200 and does
 * not back off, so a single bad deploy once turned into nine hundred readings
 * being posted every second for eleven minutes. The limit exists to make that
 * survivable rather than to keep anybody out.
 *
 * A fixed window and not a sliding one, because the whole point is that it is
 * cheap and obvious. At this traffic the boundary effect is not worth the
 * memory a sliding window would cost.
 */

export interface RateLimitOptions {
  /** Requests one caller may make in a window. */
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
  /** Paths that are never limited, such as the health endpoints. */
  readonly exempt?: readonly string[];
}

interface Window {
  count: number;
  resetAt: number;
}

export interface LimitDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
  readonly retryAfterSeconds: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimitOptions) {
    if (options.limit <= 0) {
      throw new Error('a rate limit of zero would let nothing through');
    }
    if (options.windowMs <= 0) {
      throw new Error('a window has to have a length');
    }
    this.now = options.now ?? (() => Date.now());
  }

  get size(): number {
    return this.windows.size;
  }

  take(key: string): LimitDecision {
    const at = this.now();
    const existing = this.windows.get(key);
    const window =
      existing && existing.resetAt > at
        ? existing
        : { count: 0, resetAt: at + this.options.windowMs };
    window.count += 1;
    this.windows.set(key, window);
    const remaining = Math.max(0, this.options.limit - window.count);
    return {
      allowed: window.count <= this.options.limit,
      remaining,
      resetAt: window.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - at) / 1000)),
    };
  }

  /** Drops windows that have run out, so the map does not grow forever. */
  sweep(): number {
    const at = this.now();
    let dropped = 0;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= at) {
        this.windows.delete(key);
        dropped += 1;
      }
    }
    return dropped;
  }

  reset(): void {
    this.windows.clear();
  }
}

/**
 * Keys by caller rather than by address. Every caller here is a machine with a
 * key, and several of them come through the same yard router, so an address
 * would limit the office because the monitor vendor is busy.
 */
export function rateLimitKey(request: FastifyRequest): string {
  return request.caller?.name ?? `anonymous:${request.ip}`;
}

export function rateLimit(limiter: RateLimiter, options: { exempt?: readonly string[] } = {}) {
  const exempt = new Set(options.exempt ?? ['/health', '/ready', '/metrics']);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const path = request.url.split('?')[0] ?? request.url;
    if (exempt.has(path)) {
      return;
    }
    const decision = limiter.take(rateLimitKey(request));
    reply.header('x-ratelimit-remaining', String(decision.remaining));
    reply.header('x-ratelimit-reset', String(Math.floor(decision.resetAt / 1000)));
    if (!decision.allowed) {
      reply.header('retry-after', String(decision.retryAfterSeconds));
      reply.code(429).send({
        code: 'unavailable',
        message: 'too many requests, slow down',
        detail: { retryAfterSeconds: decision.retryAfterSeconds },
      });
    }
  };
}
