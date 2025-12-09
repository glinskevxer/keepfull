import { describe, expect, it } from 'vitest';
import { ConfigError, describeSettings, loadSettings, parseApiKeys } from '../../../src/config/env';
import { hashKey } from '../../../src/api/auth';

const LONG_KEY = 'office-key-that-is-long-enough';

const minimal = {
  YARD_LATITUDE: '42.4432',
  YARD_LONGITUDE: '-76.5019',
};

describe('loadSettings', () => {
  it('fills in the defaults', () => {
    const settings = loadSettings(minimal as NodeJS.ProcessEnv);
    expect(settings.port).toBe(8080);
    expect(settings.host).toBe('127.0.0.1');
    expect(settings.databasePath).toBe('data/keepfull.db');
    expect(settings.logLevel).toBe('info');
    expect(settings.dispatchWindowDays).toBe(5);
    expect(settings.requestLogging).toBe(false);
  });

  it('coerces the numbers a shell hands over as text', () => {
    const settings = loadSettings({
      ...minimal,
      PORT: '9100',
      TAX_PERCENT: '8.5',
    } as NodeJS.ProcessEnv);
    expect(settings.port).toBe(9100);
    expect(settings.taxPercent).toBe(8.5);
  });

  it('reads the yard off the environment', () => {
    expect(loadSettings(minimal as NodeJS.ProcessEnv).yard).toEqual({
      latitude: 42.4432,
      longitude: -76.5019,
    });
  });

  it('refuses to boot without a yard', () => {
    expect(() => loadSettings({} as NodeJS.ProcessEnv)).toThrowError(ConfigError);
    expect(() => loadSettings({} as NodeJS.ProcessEnv)).toThrowError(/YARD_LATITUDE/);
  });

  it('names every problem, not just the first', () => {
    try {
      loadSettings({ YARD_LATITUDE: '200', PORT: 'soon' } as NodeJS.ProcessEnv);
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).toMatch(/PORT/);
      expect((error as Error).message).toMatch(/YARD_LONGITUDE/);
    }
  });

  it('refuses a port outside the range', () => {
    expect(() => loadSettings({ ...minimal, PORT: '70000' } as NodeJS.ProcessEnv)).toThrowError(
      /PORT/,
    );
  });

  it('refuses a log level it does not know', () => {
    expect(() =>
      loadSettings({ ...minimal, LOG_LEVEL: 'chatty' } as NodeJS.ProcessEnv),
    ).toThrowError(/LOG_LEVEL/);
  });

  it('takes a boolean as the two strings a shell can produce', () => {
    expect(
      loadSettings({ ...minimal, REQUEST_LOGGING: 'true' } as NodeJS.ProcessEnv).requestLogging,
    ).toBe(true);
  });

  it('insists on an api key in production', () => {
    expect(() =>
      loadSettings({ ...minimal, NODE_ENV: 'production' } as NodeJS.ProcessEnv),
    ).toThrowError(/at least one api key/);
  });

  it('is happy in production once there is one', () => {
    const settings = loadSettings({
      ...minimal,
      NODE_ENV: 'production',
      API_KEYS: `office:office:${LONG_KEY}`,
    } as NodeJS.ProcessEnv);
    expect(settings.keyRing.size).toBe(1);
  });
});

describe('parseApiKeys', () => {
  it('reads several entries', () => {
    const records = parseApiKeys(
      `office:office:${LONG_KEY},handhelds:driver:driver-key-that-is-long-enough`,
    );
    expect(records.map((record) => record.role)).toEqual(['office', 'driver']);
  });

  it('never keeps the key itself', () => {
    const records = parseApiKeys(`office:office:${LONG_KEY}`);
    expect(records[0]?.keyHash).toBe(hashKey(LONG_KEY));
    expect(JSON.stringify(records)).not.toContain(LONG_KEY);
  });

  it('ignores whitespace and empty entries', () => {
    expect(parseApiKeys(` office:office:${LONG_KEY} , `)).toHaveLength(1);
    expect(parseApiKeys('')).toEqual([]);
  });

  it('refuses an entry with the wrong number of parts', () => {
    expect(() => parseApiKeys('office:office')).toThrowError(/name:role:key/);
  });

  it('refuses a role it does not know', () => {
    expect(() => parseApiKeys(`office:boss:${LONG_KEY}`)).toThrowError(/is not a role/);
  });

  it('refuses a key short enough to guess', () => {
    expect(() => parseApiKeys('office:office:short')).toThrowError(/too short/);
  });
});

describe('describeSettings', () => {
  it('reports the shape without any secret in it', () => {
    const settings = loadSettings({
      ...minimal,
      API_KEYS: `office:office:${LONG_KEY}`,
    } as NodeJS.ProcessEnv);
    const described = describeSettings(settings);
    expect(described.apiKeys).toBe(1);
    expect(JSON.stringify(described)).not.toContain(LONG_KEY);
    expect(JSON.stringify(described)).not.toContain(hashKey(LONG_KEY));
  });
});
