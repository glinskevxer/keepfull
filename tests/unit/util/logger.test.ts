import { describe, expect, it } from 'vitest';
import { Logger, MemorySink, redact, silentLogger } from '../../../src/util/logger';
import { NotFoundError } from '../../../src/core/errors';

function build(level: 'debug' | 'info' | 'warn' | 'error' = 'debug') {
  const sink = new MemorySink();
  let tick = 0;
  const logger = new Logger({
    level,
    sink,
    clock: () => new Date(Date.UTC(2025, 0, 1, 0, 0, tick++)),
  });
  return { sink, logger };
}

describe('levels', () => {
  it('drops anything under the threshold', () => {
    const { sink, logger } = build('warn');
    logger.debug('one');
    logger.info('two');
    logger.warn('three');
    logger.error('four');
    expect(sink.messages()).toEqual(['three', 'four']);
  });

  it('reports what it would emit', () => {
    const { logger } = build('info');
    expect(logger.enabled('debug')).toBe(false);
    expect(logger.enabled('info')).toBe(true);
    expect(logger.enabled('error')).toBe(true);
  });
});

describe('record shape', () => {
  it('stamps the time and the level', () => {
    const { sink, logger } = build();
    logger.info('loaded the route', { stops: 14 });
    expect(sink.records[0]).toEqual({
      at: '2025-01-01T00:00:00.000Z',
      level: 'info',
      msg: 'loaded the route',
      stops: 14,
    });
  });

  it('filters by level', () => {
    const { sink, logger } = build();
    logger.warn('short delivery');
    logger.info('fine');
    expect(sink.at('warn')).toHaveLength(1);
    expect(sink.at('info')).toHaveLength(1);
  });
});

describe('child', () => {
  it('carries the parent fields onto every line', () => {
    const { sink, logger } = build();
    const run = logger.child({ runId: 'r-1' });
    run.info('started');
    run.info('finished', { tanks: 3 });
    expect(sink.records[0]?.runId).toBe('r-1');
    expect(sink.records[1]).toMatchObject({ runId: 'r-1', tanks: 3 });
  });

  it('lets the call site override an inherited field', () => {
    const { sink, logger } = build();
    logger.child({ stage: 'load' }).info('done', { stage: 'unload' });
    expect(sink.records[0]?.stage).toBe('unload');
  });
});

describe('redact', () => {
  it('blanks the fields that must never be logged', () => {
    expect(redact({ apiKey: 'abc', truckId: 'B-4' })).toEqual({
      apiKey: '[redacted]',
      truckId: 'B-4',
    });
  });

  it('reaches into nested objects', () => {
    expect(redact({ request: { token: 'xyz', path: '/tanks' } })).toEqual({
      request: { token: '[redacted]', path: '/tanks' },
    });
  });

  it('flattens an error into a readable line', () => {
    expect(redact({ error: new NotFoundError('tank', 'T-9') }).error).toBe(
      'not_found: no tank with id T-9 (what=tank id=T-9)',
    );
  });

  it('leaves arrays alone', () => {
    expect(redact({ stops: ['a', 'b'] })).toEqual({ stops: ['a', 'b'] });
  });
});

describe('timed', () => {
  it('records the duration and that it worked', async () => {
    const { sink, logger } = build();
    const result = await logger.timed('nightly forecast', async () => 7);
    expect(result).toBe(7);
    expect(sink.records[0]).toMatchObject({ msg: 'nightly forecast', ok: true, ms: 1000 });
  });

  it('logs and rethrows on a failure', async () => {
    const { sink, logger } = build();
    await expect(
      logger.timed('nightly forecast', async () => {
        throw new NotFoundError('station', 'KRUT');
      }),
    ).rejects.toThrowError(/no station with id KRUT/);
    expect(sink.at('error')[0]).toMatchObject({ ok: false });
    expect(sink.at('error')[0]?.error).toMatch(/not_found/);
  });
});

describe('silentLogger', () => {
  it('swallows everything below error', () => {
    expect(silentLogger.enabled('info')).toBe(false);
    expect(() => silentLogger.info('quiet')).not.toThrow();
  });
});
