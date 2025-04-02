import { describeError } from '../core/errors';

/**
 * One line of json per event, because the nightly jobs run unattended and the
 * only thing anybody ever does with the output is grep it six weeks later
 * looking for the tank that got skipped.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogFields = Record<string, unknown>;

export interface LogRecord {
  readonly at: string;
  readonly level: LogLevel;
  readonly msg: string;
  readonly [key: string]: unknown;
}

export interface LogSink {
  write(record: LogRecord): void;
}

export const consoleSink: LogSink = {
  write(record) {
    const line = JSON.stringify(record);
    if (record.level === 'error' || record.level === 'warn') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  },
};

/** Collects records instead of printing them. Tests and the cli dry run use it. */
export class MemorySink implements LogSink {
  readonly records: LogRecord[] = [];

  write(record: LogRecord): void {
    this.records.push(record);
  }

  clear(): void {
    this.records.length = 0;
  }

  messages(): string[] {
    return this.records.map((record) => record.msg);
  }

  at(level: LogLevel): LogRecord[] {
    return this.records.filter((record) => record.level === level);
  }
}

/** Field names whose values never belong in a log file. */
const REDACTED = new Set(['apiKey', 'password', 'token', 'authorization', 'creditCard']);

export function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (REDACTED.has(key)) {
      out[key] = '[redacted]';
    } else if (value instanceof Error) {
      out[key] = describeError(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redact(value as LogFields);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly sink?: LogSink;
  readonly base?: LogFields;
  readonly clock?: () => Date;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly sink: LogSink;
  private readonly base: LogFields;
  private readonly clock: () => Date;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.sink = options.sink ?? consoleSink;
    this.base = options.base ?? {};
    this.clock = options.clock ?? (() => new Date());
  }

  /** A logger that stamps every line with the same fields, such as a run id. */
  child(fields: LogFields): Logger {
    return new Logger({
      level: this.level,
      sink: this.sink,
      base: { ...this.base, ...fields },
      clock: this.clock,
    });
  }

  enabled(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
  }

  log(level: LogLevel, msg: string, fields: LogFields = {}): void {
    if (!this.enabled(level)) {
      return;
    }
    this.sink.write({
      at: this.clock().toISOString(),
      level,
      msg,
      ...redact({ ...this.base, ...fields }),
    });
  }

  debug(msg: string, fields?: LogFields): void {
    this.log('debug', msg, fields);
  }

  info(msg: string, fields?: LogFields): void {
    this.log('info', msg, fields);
  }

  warn(msg: string, fields?: LogFields): void {
    this.log('warn', msg, fields);
  }

  error(msg: string, fields?: LogFields): void {
    this.log('error', msg, fields);
  }

  /** Logs how long something took, whether or not it worked. */
  async timed<T>(msg: string, work: () => Promise<T>, fields: LogFields = {}): Promise<T> {
    const started = this.clock().getTime();
    try {
      const result = await work();
      this.info(msg, { ...fields, ms: this.clock().getTime() - started, ok: true });
      return result;
    } catch (error) {
      this.error(msg, { ...fields, ms: this.clock().getTime() - started, ok: false, error });
      throw error;
    }
  }
}

export const silentLogger = new Logger({ level: 'error', sink: new MemorySink() });
