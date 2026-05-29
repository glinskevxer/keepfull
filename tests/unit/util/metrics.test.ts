import { describe, expect, it } from 'vitest';
import { Registry, buildRegistry } from '../../../src/util/metrics';

function registry(): Registry {
  const instance = new Registry();
  instance.counter('requests_total', 'requests');
  instance.gauge('tanks', 'tanks');
  instance.histogram('duration_ms', 'duration');
  return instance;
}

describe('counters', () => {
  it('counts up', () => {
    const metrics = registry();
    metrics.increment('requests_total');
    metrics.increment('requests_total');
    expect(metrics.read('requests_total')).toBe(2);
  });

  it('keeps label sets apart', () => {
    const metrics = registry();
    metrics.increment('requests_total', { status: '200' });
    metrics.increment('requests_total', { status: '404' });
    expect(metrics.read('requests_total', { status: '200' })).toBe(1);
  });

  it('does not care what order the labels arrive in', () => {
    const metrics = registry();
    metrics.increment('requests_total', { a: '1', b: '2' });
    metrics.increment('requests_total', { b: '2', a: '1' });
    expect(metrics.read('requests_total', { a: '1', b: '2' })).toBe(2);
  });

  it('takes a step other than one', () => {
    const metrics = registry();
    metrics.increment('requests_total', {}, 5);
    expect(metrics.read('requests_total')).toBe(5);
  });

  it('refuses a series nobody declared', () => {
    expect(() => registry().increment('nope')).toThrowError(/no counter called "nope"/);
    expect(() => registry().set('nope', 1)).toThrowError(/no gauge called "nope"/);
    expect(() => registry().observe('nope', 1)).toThrowError(/no histogram called "nope"/);
  });
});

describe('gauges', () => {
  it('holds the last value rather than adding up', () => {
    const metrics = registry();
    metrics.set('tanks', 900);
    metrics.set('tanks', 899);
    expect(metrics.read('tanks')).toBe(899);
  });
});

describe('render', () => {
  it('writes the help and type lines', () => {
    const metrics = registry();
    metrics.increment('requests_total');
    const text = metrics.render();
    expect(text).toContain('# HELP requests_total requests');
    expect(text).toContain('# TYPE requests_total counter');
    expect(text).toContain('requests_total 1');
  });

  it('renders labels in the usual shape', () => {
    const metrics = registry();
    metrics.increment('requests_total', { method: 'GET', status: '200' });
    expect(metrics.render()).toContain('requests_total{method="GET",status="200"} 1');
  });

  it('escapes a label value that would break the format', () => {
    const metrics = registry();
    metrics.increment('requests_total', { path: 'a"b' });
    expect(metrics.render()).toContain('path="a\\"b"');
  });

  it('renders a histogram as cumulative buckets with a sum and a count', () => {
    const metrics = registry();
    metrics.observe('duration_ms', 3);
    metrics.observe('duration_ms', 30);
    metrics.observe('duration_ms', 3000);
    const text = metrics.render([10, 100]);
    expect(text).toContain('duration_ms_bucket{le="10"} 1');
    expect(text).toContain('duration_ms_bucket{le="100"} 2');
    expect(text).toContain('duration_ms_bucket{le="+Inf"} 3');
    expect(text).toContain('duration_ms_sum 3033');
    expect(text).toContain('duration_ms_count 3');
  });

  it('puts the bucket label alongside the others', () => {
    const metrics = registry();
    metrics.observe('duration_ms', 3, { route: '/health' });
    expect(metrics.render([10])).toContain('duration_ms_bucket{route="/health",le="10"} 1');
  });

  it('ends with a newline, which the scraper insists on', () => {
    const metrics = registry();
    metrics.increment('requests_total');
    expect(metrics.render().endsWith('\n')).toBe(true);
  });

  it('renders a declared series with nothing in it', () => {
    const text = registry().render();
    expect(text).toContain('# TYPE tanks gauge');
    expect(text).not.toContain('tanks 0');
  });
});

describe('reset', () => {
  it('clears the values but keeps the series', () => {
    const metrics = registry();
    metrics.increment('requests_total');
    metrics.reset();
    expect(metrics.read('requests_total')).toBeUndefined();
    expect(metrics.render()).toContain('# TYPE requests_total counter');
  });
});

describe('buildRegistry', () => {
  it('declares what this system publishes', () => {
    const text = buildRegistry().render();
    for (const name of [
      'keepfull_requests_total',
      'keepfull_request_duration_ms',
      'keepfull_tanks_in_service',
      'keepfull_exceptions_open',
    ]) {
      expect(text).toContain(`# TYPE ${name}`);
    }
  });
});
