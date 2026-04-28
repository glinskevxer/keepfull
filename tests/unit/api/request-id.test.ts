import { describe, expect, it } from 'vitest';
import { FastifyRequest } from 'fastify';
import { readRequestId } from '../../../src/api/request-id';

function request(headers: Record<string, unknown>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe('readRequestId', () => {
  it('takes a well formed id from the caller', () => {
    expect(readRequestId(request({ 'x-request-id': 'handheld-4471.2' }))).toBe('handheld-4471.2');
  });

  it('reports nothing when there is no header', () => {
    expect(readRequestId(request({}))).toBeUndefined();
  });

  it('takes the first when a proxy sent several', () => {
    expect(readRequestId(request({ 'x-request-id': ['a', 'b'] }))).toBe('a');
  });

  it('refuses one that would not be safe in a log line', () => {
    expect(readRequestId(request({ 'x-request-id': 'has a space' }))).toBeUndefined();
    expect(readRequestId(request({ 'x-request-id': 'newline\ninjected' }))).toBeUndefined();
    expect(readRequestId(request({ 'x-request-id': '' }))).toBeUndefined();
  });

  it('refuses one long enough to be a problem', () => {
    expect(readRequestId(request({ 'x-request-id': 'a'.repeat(65) }))).toBeUndefined();
    expect(readRequestId(request({ 'x-request-id': 'a'.repeat(64) }))).toBe('a'.repeat(64));
  });
});
