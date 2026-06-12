import { describe, expect, it } from 'vitest';
import {
  defined,
  flag,
  optionalDay,
  optionalList,
  optionalNumber,
  optionalText,
} from '../../../src/api/query-params';

describe('defined', () => {
  it('drops the keys that were not given', () => {
    expect(defined({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' });
  });

  it('keeps a falsy value that is not undefined', () => {
    expect(defined({ a: 0, b: '', c: false, d: null })).toEqual({
      a: 0,
      b: '',
      c: false,
      d: null,
    });
  });

  it('gives an empty object back when nothing was given', () => {
    expect(defined({ a: undefined })).toEqual({});
  });
});

describe('flag', () => {
  it('is true only for the literal true', () => {
    expect(flag('true')).toBe(true);
  });

  it('is undefined for false, so a filter is left off rather than inverted', () => {
    expect(flag('false')).toBeUndefined();
    expect(flag('')).toBeUndefined();
    expect(flag(undefined)).toBeUndefined();
    expect(flag('1')).toBeUndefined();
  });
});

describe('optionalDay', () => {
  it('parses a real day', () => {
    expect(optionalDay('2026-06-10')).toBe('2026-06-10');
  });

  it('is undefined when absent or blank', () => {
    expect(optionalDay(undefined)).toBeUndefined();
    expect(optionalDay('')).toBeUndefined();
  });

  it('still refuses something that is not a day', () => {
    expect(() => optionalDay('soon')).toThrowError();
  });
});

describe('optionalNumber', () => {
  it('parses a number', () => {
    expect(optionalNumber('25')).toBe(25);
    expect(optionalNumber('0')).toBe(0);
    expect(optionalNumber('-2.5')).toBe(-2.5);
  });

  it('is undefined when absent or blank', () => {
    expect(optionalNumber(undefined)).toBeUndefined();
    expect(optionalNumber('')).toBeUndefined();
  });

  it('refuses something that is not a number', () => {
    expect(() => optionalNumber('lots')).toThrowError(/not a number/);
  });
});

describe('optionalText', () => {
  it('treats blank as absent', () => {
    expect(optionalText('  ')).toBeUndefined();
    expect(optionalText('')).toBeUndefined();
    expect(optionalText(undefined)).toBeUndefined();
  });

  it('keeps a real value untrimmed', () => {
    expect(optionalText(' a ')).toBe(' a ');
  });
});

describe('optionalList', () => {
  it('splits on commas and drops the blanks', () => {
    expect(optionalList('a, b ,,c')).toEqual(['a', 'b', 'c']);
  });

  it('is undefined for nothing usable', () => {
    expect(optionalList(undefined)).toBeUndefined();
    expect(optionalList(' , , ')).toBeUndefined();
  });
});
