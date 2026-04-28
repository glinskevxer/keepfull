import { z } from 'zod';
import { KeyRecord, KeyRing, ROLES, Role, makeKeyRecord } from '../api/auth';
import { LogLevel } from '../util/logger';

/**
 * Everything that differs between the yard machine and a laptop.
 *
 * Parsed once at start up and never read again, so a missing variable is a
 * process that will not boot rather than a request that fails at four in the
 * afternoon in the middle of a delivery.
 *
 * Api keys arrive as `name:role:key` triples separated by commas. They are
 * hashed on the way in and the plain values are never held, so a heap dump or a
 * crash report cannot hand anybody the yard.
 */

const levels = ['debug', 'info', 'warn', 'error'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_PATH: z.string().min(1).default('data/keepfull.db'),
  LOG_LEVEL: z.enum(levels).default('info'),
  YARD_LATITUDE: z.coerce.number().min(-90).max(90),
  YARD_LONGITUDE: z.coerce.number().min(-180).max(180),
  DEFAULT_HORIZON_DAYS: z.coerce.number().int().min(1).max(365).default(120),
  DISPATCH_WINDOW_DAYS: z.coerce.number().int().min(0).max(60).default(5),
  TAX_PERCENT: z.coerce.number().min(0).max(30).default(0),
  API_KEYS: z.string().default(''),
  REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).optional(),
  REQUEST_LOGGING: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export interface Settings {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly host: string;
  readonly databasePath: string;
  readonly logLevel: LogLevel;
  readonly yard: { latitude: number; longitude: number };
  readonly defaultHorizonDays: number;
  readonly dispatchWindowDays: number;
  readonly taxPercent: number;
  readonly keyRing: KeyRing;
  readonly requestsPerMinute?: number;
  readonly requestLogging: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function parseApiKeys(raw: string): KeyRecord[] {
  const records: KeyRecord[] = [];
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const parts = trimmed.split(':');
    if (parts.length !== 3) {
      throw new ConfigError(`api key entries look like name:role:key, got "${trimmed}"`);
    }
    const [name, role, key] = parts as [string, string, string];
    if (!ROLES.includes(role as Role)) {
      throw new ConfigError(`"${role}" is not a role, in api key entry "${name}"`);
    }
    if (key.length < 24) {
      throw new ConfigError(`the api key for "${name}" is too short to be worth having`);
    }
    records.push(makeKeyRecord(name, role as Role, key));
  }
  return records;
}

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`the environment is not usable: ${problems}`);
  }
  const values = parsed.data;
  const keys = parseApiKeys(values.API_KEYS);
  if (values.NODE_ENV === 'production' && keys.length === 0) {
    throw new ConfigError('production needs at least one api key in API_KEYS');
  }
  return {
    nodeEnv: values.NODE_ENV,
    port: values.PORT,
    host: values.HOST,
    databasePath: values.DATABASE_PATH,
    logLevel: values.LOG_LEVEL,
    yard: { latitude: values.YARD_LATITUDE, longitude: values.YARD_LONGITUDE },
    defaultHorizonDays: values.DEFAULT_HORIZON_DAYS,
    dispatchWindowDays: values.DISPATCH_WINDOW_DAYS,
    taxPercent: values.TAX_PERCENT,
    keyRing: new KeyRing(keys),
    ...(values.REQUESTS_PER_MINUTE === undefined
      ? {}
      : { requestsPerMinute: values.REQUESTS_PER_MINUTE }),
    requestLogging: values.REQUEST_LOGGING,
  };
}

/** Everything except the secrets, for the start up log line. */
export function describeSettings(settings: Settings): Record<string, unknown> {
  return {
    nodeEnv: settings.nodeEnv,
    host: settings.host,
    port: settings.port,
    databasePath: settings.databasePath,
    logLevel: settings.logLevel,
    yard: settings.yard,
    dispatchWindowDays: settings.dispatchWindowDays,
    apiKeys: settings.keyRing.size,
    requestsPerMinute: settings.requestsPerMinute ?? null,
  };
}
