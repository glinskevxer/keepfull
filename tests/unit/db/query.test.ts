import { describe, expect, it } from 'vitest';
import { WhereClause, limitOf } from '../../../src/db/query';

describe('WhereClause', () => {
  it('is empty until something is added', () => {
    const where = new WhereClause();
    expect(where.sql).toBe('');
    expect(where.isEmpty).toBe(true);
    expect(where.bind()).toEqual({});
  });

  it('skips a filter that was not set', () => {
    const where = new WhereClause().eq('town', 'town', undefined).eq('county', 'county', null);
    expect(where.sql).toBe('');
  });

  it('joins several with AND', () => {
    const where = new WhereClause().eq('town', 'town', 'Danby').eq('county', 'county', 'Tompkins');
    expect(where.sql).toBe('WHERE town = @town AND county = @county');
    expect(where.bind()).toEqual({ town: 'Danby', county: 'Tompkins' });
  });

  it('handles a range', () => {
    const where = new WhereClause().gte('day', 'from', '2025-01-01').lte('day', 'to', '2025-02-01');
    expect(where.sql).toBe('WHERE day >= @from AND day <= @to');
  });

  it('adds a bare clause behind a flag', () => {
    expect(new WhereClause().when(true, 'closed_on IS NULL').sql).toBe('WHERE closed_on IS NULL');
    expect(new WhereClause().when(false, 'closed_on IS NULL').sql).toBe('');
    expect(new WhereClause().when(undefined, 'closed_on IS NULL').sql).toBe('');
  });

  it('takes zero as a real value rather than an absent one', () => {
    expect(new WhereClause().gte('n', 'n', 0).bind()).toEqual({ n: 0 });
  });

  it('merges extra bindings without losing the filters', () => {
    const where = new WhereClause().eq('town', 'town', 'Danby');
    expect(where.bind({ limit: 10 })).toEqual({ town: 'Danby', limit: 10 });
  });

  it('chains', () => {
    const where = new WhereClause();
    expect(where.eq('a', 'a', 1)).toBe(where);
    expect(where.when(true, 'b IS NULL')).toBe(where);
  });
});

describe('limitOf', () => {
  it('turns an absent page size into no limit', () => {
    expect(limitOf(undefined)).toBe(-1);
    expect(limitOf(-5)).toBe(-1);
  });

  it('passes a real page size through, including zero', () => {
    expect(limitOf(25)).toBe(25);
    expect(limitOf(0)).toBe(0);
  });
});
