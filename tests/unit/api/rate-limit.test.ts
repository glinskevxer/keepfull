import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/api/rate-limit';

function limiter(limit = 3, windowMs = 1000) {
  let now = 1_000_000;
  const instance = new RateLimiter({ limit, windowMs, now: () => now });
  return { instance, advance: (ms: number) => (now += ms) };
}

describe('RateLimiter', () => {
  it('lets requests through up to the limit', () => {
    const { instance } = limiter();
    expect(instance.take('a').allowed).toBe(true);
    expect(instance.take('a').allowed).toBe(true);
    expect(instance.take('a').allowed).toBe(true);
    expect(instance.take('a').allowed).toBe(false);
  });

  it('counts down what is left', () => {
    const { instance } = limiter();
    expect(instance.take('a').remaining).toBe(2);
    expect(instance.take('a').remaining).toBe(1);
    expect(instance.take('a').remaining).toBe(0);
    expect(instance.take('a').remaining).toBe(0);
  });

  it('keeps callers apart', () => {
    const { instance } = limiter(1);
    expect(instance.take('a').allowed).toBe(true);
    expect(instance.take('b').allowed).toBe(true);
    expect(instance.take('a').allowed).toBe(false);
  });

  it('opens a fresh window once the old one runs out', () => {
    const { instance, advance } = limiter(1, 1000);
    expect(instance.take('a').allowed).toBe(true);
    expect(instance.take('a').allowed).toBe(false);
    advance(1001);
    expect(instance.take('a').allowed).toBe(true);
  });

  it('says how long to wait', () => {
    const { instance, advance } = limiter(1, 5000);
    instance.take('a');
    advance(1500);
    expect(instance.take('a').retryAfterSeconds).toBe(4);
  });

  it('never says wait zero seconds', () => {
    const { instance, advance } = limiter(1, 1000);
    instance.take('a');
    advance(999);
    expect(instance.take('a').retryAfterSeconds).toBe(1);
  });

  it('sweeps windows that have run out', () => {
    const { instance, advance } = limiter(5, 1000);
    instance.take('a');
    instance.take('b');
    expect(instance.size).toBe(2);
    expect(instance.sweep()).toBe(0);
    advance(1001);
    expect(instance.sweep()).toBe(2);
    expect(instance.size).toBe(0);
  });

  it('can be reset outright', () => {
    const { instance } = limiter(1);
    instance.take('a');
    instance.reset();
    expect(instance.take('a').allowed).toBe(true);
  });

  it('refuses a limit or window that would make no sense', () => {
    expect(() => new RateLimiter({ limit: 0, windowMs: 1000 })).toThrowError(/let nothing through/);
    expect(() => new RateLimiter({ limit: 1, windowMs: 0 })).toThrowError(/has to have a length/);
  });
});
