import { afterEach, describe, expect, it } from 'vitest';
import { FastifyRequest } from 'fastify';
import { buildScenario } from '../../support/scenario';
import { callerOf, rangeFrom } from '../../../src/api/caller';
import { closeTestDatabases } from '../../support/db';

afterEach(closeTestDatabases);

function request(fields: Record<string, unknown>): FastifyRequest {
  return fields as unknown as FastifyRequest;
}

describe('callerOf', () => {
  it('names the caller and carries the request id', () => {
    expect(callerOf(request({ caller: { name: 'office screens' }, requestId: 'req-1' }))).toEqual({
      actor: 'office screens',
      requestId: 'req-1',
    });
  });

  it('says unknown rather than system when nobody is named', () => {
    expect(callerOf(request({}))).toEqual({ actor: 'unknown' });
  });

  it('leaves the request id off when there is none', () => {
    expect(callerOf(request({ caller: { name: 'a' } }))).toEqual({ actor: 'a' });
  });
});

describe('rangeFrom', () => {
  const context = () => buildScenario({ today: '2026-08-04' }).context;

  it('ends today and runs back the default', () => {
    expect(rangeFrom(context(), {}, 30)).toEqual({ from: '2026-07-05', to: '2026-08-04' });
  });

  it('takes an explicit end and keeps the default span', () => {
    expect(rangeFrom(context(), { to: '2026-01-31' }, 30)).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('takes both ends', () => {
    expect(rangeFrom(context(), { from: '2026-01-01', to: '2026-02-01' }, 30)).toEqual({
      from: '2026-01-01',
      to: '2026-02-01',
    });
  });

  it('refuses a range that runs backwards', () => {
    expect(() => rangeFrom(context(), { from: '2026-03-01', to: '2026-01-01' }, 30)).toThrowError(
      /runs backwards/,
    );
  });

  it('refuses a day that is not a day', () => {
    expect(() => rangeFrom(context(), { from: 'soon' }, 30)).toThrowError();
  });
});
