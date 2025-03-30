import { describe, expect, it } from 'vitest';
import {
  optionalColumn,
  parseCsv,
  parseCsvTable,
  requireColumn,
  writeCsv,
  writeCsvTable,
} from '../../../src/util/csv';

describe('parseCsv', () => {
  it('reads plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('trims by default and can be told not to', () => {
    expect(parseCsv('a , b')).toEqual([['a', 'b']]);
    expect(parseCsv('a , b', { trim: false })).toEqual([['a ', ' b']]);
  });

  it('keeps a comma inside quotes', () => {
    expect(parseCsv('"Ridge, Kent",500')).toEqual([['Ridge, Kent', '500']]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('"he said ""fill it""",1')).toEqual([['he said "fill it"', '1']]);
  });

  it('keeps a newline inside quotes', () => {
    expect(parseCsv('"line one\nline two",2')).toEqual([['line one\nline two', '2']]);
  });

  it('handles carriage returns', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops a byte order mark', () => {
    expect(parseCsv('﻿day,hdd\n2025-01-01,42')[0]).toEqual(['day', 'hdd']);
  });

  it('keeps empty fields', () => {
    expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
  });

  it('ignores a trailing newline', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('refuses a file that ends mid quote', () => {
    expect(() => parseCsv('"unterminated,1')).toThrowError(/inside a quoted field/);
  });

  it('refuses a delimiter that is not one character', () => {
    expect(() => parseCsv('a,b', { delimiter: '||' })).toThrowError(/single character/);
  });

  it('takes another delimiter', () => {
    expect(parseCsv('a|b', { delimiter: '|' })).toEqual([['a', 'b']]);
  });

  it('returns nothing for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseCsvTable', () => {
  const text = 'Day,High,Low\n2025-01-01,35,15\n2025-01-02,40,20';

  it('lowercases the headers', () => {
    expect(parseCsvTable(text).headers).toEqual(['day', 'high', 'low']);
  });

  it('keys the rows', () => {
    expect(parseCsvTable(text).rows[0]).toEqual({ day: '2025-01-01', high: '35', low: '15' });
  });

  it('refuses a duplicated header', () => {
    expect(() => parseCsvTable('day,day\n1,2')).toThrowError(/appears twice/);
  });

  it('refuses a short row and says which one', () => {
    expect(() => parseCsvTable('a,b,c\n1,2')).toThrowError(/row 2 has 2 fields against 3 headers/);
  });

  it('handles a file with headers and nothing else', () => {
    expect(parseCsvTable('a,b')).toEqual({ headers: ['a', 'b'], rows: [] });
  });

  it('handles an empty file', () => {
    expect(parseCsvTable('')).toEqual({ headers: [], rows: [] });
  });
});

describe('column access', () => {
  const row = { day: '2025-01-01', note: '', high: '35' };

  it('requires a value', () => {
    expect(requireColumn(row, 'day')).toBe('2025-01-01');
    expect(() => requireColumn(row, 'low')).toThrowError(/no column called "low"/);
    expect(() => requireColumn(row, 'note')).toThrowError(/must not be blank/);
  });

  it('treats blank as absent when it is optional', () => {
    expect(optionalColumn(row, 'high')).toBe('35');
    expect(optionalColumn(row, 'note')).toBeUndefined();
    expect(optionalColumn(row, 'missing')).toBeUndefined();
  });
});

describe('writeCsv', () => {
  it('quotes only what needs it', () => {
    expect(writeCsv([['plain', 'has,comma', 'has"quote', 'has\nnewline']])).toBe(
      'plain,"has,comma","has""quote","has\nnewline"',
    );
  });

  it('round trips through the parser', () => {
    const rows = [
      ['day', 'note'],
      ['2025-01-01', 'left gate open, again'],
      ['2025-01-02', 'said "no fill"'],
    ];
    expect(parseCsv(writeCsv(rows))).toEqual(rows);
  });

  it('writes a keyed table and fills gaps with blanks', () => {
    const text = writeCsvTable(['day', 'hdd'], [{ day: '2025-01-01' }]);
    expect(text).toBe('day,hdd\n2025-01-01,');
  });
});
