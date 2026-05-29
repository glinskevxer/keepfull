/**
 * Counters and timings, in the format the yard's monitoring already scrapes.
 *
 * There is no metrics library here on purpose. What gets watched is four
 * numbers, the scrape happens once a minute, and pulling in a client with its
 * own registry, label cardinality rules and default process collectors would be
 * more code than this whole file for no benefit anybody could name.
 */

export type Labels = Readonly<Record<string, string>>;

interface Series {
  readonly name: string;
  readonly help: string;
  readonly type: 'counter' | 'gauge' | 'histogram';
}

/** Buckets in milliseconds. A request over two seconds is already a problem. */
export const DEFAULT_BUCKETS: readonly number[] = [5, 10, 25, 50, 100, 250, 500, 1000, 2000];

function keyOf(labels: Labels): string {
  const entries = Object.entries(labels).sort(([left], [right]) => (left < right ? -1 : 1));
  return entries.map(([name, value]) => `${name}=${escape(value)}`).join(',');
}

function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function renderLabels(key: string): string {
  if (key.length === 0) {
    return '';
  }
  const parts = key.split(',').map((pair) => {
    const index = pair.indexOf('=');
    return `${pair.slice(0, index)}="${pair.slice(index + 1)}"`;
  });
  return `{${parts.join(',')}}`;
}

export class Registry {
  private readonly series = new Map<string, Series>();
  private readonly counters = new Map<string, Map<string, number>>();
  private readonly gauges = new Map<string, Map<string, number>>();
  private readonly histograms = new Map<string, Map<string, number[]>>();

  counter(name: string, help: string): void {
    this.series.set(name, { name, help, type: 'counter' });
    if (!this.counters.has(name)) {
      this.counters.set(name, new Map());
    }
  }

  gauge(name: string, help: string): void {
    this.series.set(name, { name, help, type: 'gauge' });
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Map());
    }
  }

  histogram(name: string, help: string): void {
    this.series.set(name, { name, help, type: 'histogram' });
    if (!this.histograms.has(name)) {
      this.histograms.set(name, new Map());
    }
  }

  increment(name: string, labels: Labels = {}, by = 1): void {
    const bucket = this.counters.get(name);
    if (!bucket) {
      throw new Error(`no counter called "${name}"`);
    }
    const key = keyOf(labels);
    bucket.set(key, (bucket.get(key) ?? 0) + by);
  }

  set(name: string, value: number, labels: Labels = {}): void {
    const bucket = this.gauges.get(name);
    if (!bucket) {
      throw new Error(`no gauge called "${name}"`);
    }
    bucket.set(keyOf(labels), value);
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    const bucket = this.histograms.get(name);
    if (!bucket) {
      throw new Error(`no histogram called "${name}"`);
    }
    const key = keyOf(labels);
    const values = bucket.get(key);
    if (values) {
      values.push(value);
    } else {
      bucket.set(key, [value]);
    }
  }

  read(name: string, labels: Labels = {}): number | undefined {
    const key = keyOf(labels);
    return this.counters.get(name)?.get(key) ?? this.gauges.get(name)?.get(key);
  }

  reset(): void {
    for (const bucket of this.counters.values()) {
      bucket.clear();
    }
    for (const bucket of this.gauges.values()) {
      bucket.clear();
    }
    for (const bucket of this.histograms.values()) {
      bucket.clear();
    }
  }

  render(buckets: readonly number[] = DEFAULT_BUCKETS): string {
    const lines: string[] = [];
    for (const series of this.series.values()) {
      lines.push(`# HELP ${series.name} ${series.help}`);
      lines.push(`# TYPE ${series.name} ${series.type}`);
      if (series.type === 'counter' || series.type === 'gauge') {
        const bucket =
          series.type === 'counter' ? this.counters.get(series.name) : this.gauges.get(series.name);
        for (const [key, value] of bucket ?? []) {
          lines.push(`${series.name}${renderLabels(key)} ${value}`);
        }
        continue;
      }
      for (const [key, values] of this.histograms.get(series.name) ?? []) {
        const sorted = [...values].sort((left, right) => left - right);
        let cumulative = 0;
        let index = 0;
        for (const edge of buckets) {
          while (index < sorted.length && (sorted[index] as number) <= edge) {
            cumulative += 1;
            index += 1;
          }
          const labels = key.length === 0 ? `le=${edge}` : `${key},le=${edge}`;
          lines.push(`${series.name}_bucket${renderLabels(labels)} ${cumulative}`);
        }
        const infinite = key.length === 0 ? 'le=+Inf' : `${key},le=+Inf`;
        lines.push(`${series.name}_bucket${renderLabels(infinite)} ${sorted.length}`);
        lines.push(
          `${series.name}_sum${renderLabels(key)} ${sorted.reduce((total, value) => total + value, 0)}`,
        );
        lines.push(`${series.name}_count${renderLabels(key)} ${sorted.length}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }
}

/** The series this system actually publishes. */
export function buildRegistry(): Registry {
  const registry = new Registry();
  registry.counter('keepfull_requests_total', 'http requests handled, by method status and role');
  registry.histogram('keepfull_request_duration_ms', 'how long a request took');
  registry.gauge('keepfull_tanks_in_service', 'tanks currently in the ground');
  registry.gauge('keepfull_tanks_forecastable', 'tanks with a usable burn model');
  registry.gauge('keepfull_exceptions_open', 'entries on the morning board, by urgency');
  return registry;
}
