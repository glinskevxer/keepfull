import { afterEach, describe, expect, it } from 'vitest';
import {
  SPOOL_ENV,
  parseSpoolName,
  readObservations,
  selectFiles,
  weatherIngest,
} from '../../../src/jobs/weather-ingest';
import { buildJobRegistry } from '../../../src/jobs';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runJob } from '../../../src/jobs/runner';
import { tmpdir } from 'node:os';

const dirs: string[] = [];
const before = process.env[SPOOL_ENV];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
  if (before === undefined) {
    delete process.env[SPOOL_ENV];
  } else {
    process.env[SPOOL_ENV] = before;
  }
  closeTestDatabases();
});

function spool(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'keepfull-spool-'));
  dirs.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents, 'utf8');
  }
  process.env[SPOOL_ENV] = dir;
  return dir;
}

function setup() {
  const scenario = buildScenario({
    today: '2026-01-20',
    weatherFrom: '2026-01-01',
    weatherTo: '2026-01-18',
  });
  return { scenario, job: { app: scenario.context, today: scenario.today, dryRun: false } };
}

describe('parseSpoolName', () => {
  it('reads the station and the day out of the name', () => {
    expect(parseSpoolName('KITH-2026-01-19.csv')).toEqual({
      name: 'KITH-2026-01-19.csv',
      stationId: 'KITH',
      day: '2026-01-19',
    });
  });

  it('ignores anything else in the directory', () => {
    for (const name of ['notes.txt', 'KITH.csv', 'kith-2026-01-19.csv', '2026-01-19.csv']) {
      expect(parseSpoolName(name)).toBeUndefined();
    }
  });
});

describe('selectFiles', () => {
  const names = [
    'KITH-2026-01-19.csv',
    'KITH-2025-12-01.csv',
    'KELM-2026-01-19.csv',
    'KITH-2026-02-01.csv',
    'readme.txt',
  ];

  it('takes what is inside the window and named right', () => {
    expect(selectFiles(names, '2026-01-20', 14).map((file) => file.name)).toEqual([
      'KELM-2026-01-19.csv',
      'KITH-2026-01-19.csv',
    ]);
  });

  it('leaves the future alone', () => {
    expect(selectFiles(names, '2026-01-20', 400).some((file) => file.day > '2026-01-20')).toBe(
      false,
    );
  });
});

describe('readObservations', () => {
  it('reads the good rows and names the bad ones', () => {
    const result = readObservations(
      'day,high,low\n2026-01-19,30,12\nnot-a-day,30,12\n2026-01-18,9,28\n',
    );
    expect(result.observations).toHaveLength(1);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[1]).toMatch(/low 28 is above high 9/);
  });
});

describe('weather-ingest', () => {
  it('is in the registry', () => {
    expect(buildJobRegistry().names()).toContain('weather-ingest');
  });

  it('does nothing when the spool is not configured', () => {
    delete process.env[SPOOL_ENV];
    const { job } = setup();
    const result = runJob(weatherIngest, job);
    expect(String(result.detail.skipped)).toMatch(/is not set/);
  });

  it('says so when the directory is not there', () => {
    process.env[SPOOL_ENV] = join(tmpdir(), 'keepfull-not-a-directory-4471');
    const { job } = setup();
    expect(String(runJob(weatherIngest, job).detail.skipped)).toMatch(/cannot read/);
  });

  it('loads what the pull dropped', () => {
    spool({ 'KITH-2026-01-19.csv': 'day,high,low\n2026-01-19,30,12\n2026-01-20,28,9\n' });
    const { scenario, job } = setup();
    const result = runJob(weatherIngest, job);
    expect(result.detail.observations).toBe(2);
    expect(scenario.context.weather.latestObservationDay('KITH')).toBe('2026-01-20');
  });

  it('is idempotent, because the pull re-sends the week', () => {
    spool({ 'KITH-2026-01-19.csv': 'day,high,low\n2026-01-19,30,12\n' });
    const { scenario, job } = setup();
    runJob(weatherIngest, job);
    const after = scenario.context.weather.countObservations('KITH');
    runJob(weatherIngest, job);
    expect(scenario.context.weather.countObservations('KITH')).toBe(after);
  });

  it('writes nothing on a dry run', () => {
    spool({ 'KITH-2026-01-19.csv': 'day,high,low\n2026-01-19,30,12\n' });
    const { scenario, job } = setup();
    runJob(weatherIngest, { ...job, dryRun: true });
    expect(scenario.context.weather.latestObservationDay('KITH')).toBe('2026-01-18');
  });

  it('names a station the spool has that we do not', () => {
    spool({ 'KBUF-2026-01-19.csv': 'day,high,low\n2026-01-19,30,12\n' });
    const { scenario, job } = setup();
    const result = runJob(weatherIngest, job);
    expect(result.detail.unknownStations).toEqual(['KBUF']);
    expect(scenario.sink.messages()).toContain('the spool named stations we do not have');
  });

  it('records a bad row as a failure without losing the file', () => {
    spool({ 'KITH-2026-01-19.csv': 'day,high,low\n2026-01-19,30,12\nbad,30,12\n' });
    const { job } = setup();
    const result = runJob(weatherIngest, job);
    expect(result.detail.observations).toBe(1);
    expect(result.failures).toHaveLength(1);
  });
});
