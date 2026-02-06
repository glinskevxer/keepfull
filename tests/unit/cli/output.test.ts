import { describe, expect, it } from 'vitest';
import {
  Column,
  MemoryWriter,
  emit,
  gallons,
  padLeft,
  padTo,
  percentOf,
  table,
} from '../../../src/cli/output';

interface Row {
  id: string;
  gallons: number;
}

const columns: Column<Row>[] = [
  { header: 'tank', get: (row) => row.id },
  { header: 'gallons', get: (row) => gallons(row.gallons), align: 'right' },
];

describe('MemoryWriter', () => {
  it('keeps the two streams apart', () => {
    const writer = new MemoryWriter();
    writer.out('one');
    writer.err('two');
    expect(writer.stdout).toEqual(['one']);
    expect(writer.stderr).toEqual(['two']);
    expect(writer.text).toBe('one');
  });
});

describe('emit', () => {
  it('prints json when asked', () => {
    const writer = new MemoryWriter();
    emit(writer, 'json', { a: 1 }, () => 'text form');
    expect(JSON.parse(writer.text)).toEqual({ a: 1 });
  });

  it('prints the text form otherwise', () => {
    const writer = new MemoryWriter();
    emit(writer, 'text', { a: 1 }, () => 'text form');
    expect(writer.text).toBe('text form');
  });

  it('does not build the text when it is going to print json', () => {
    const writer = new MemoryWriter();
    let built = 0;
    emit(writer, 'json', { a: 1 }, () => {
      built += 1;
      return 'x';
    });
    expect(built).toBe(0);
  });
});

describe('padding', () => {
  it('pads on the right and the left', () => {
    expect(padTo('ab', 5)).toBe('ab   ');
    expect(padLeft('ab', 5)).toBe('   ab');
  });

  it('leaves something already long enough alone', () => {
    expect(padTo('abcdef', 3)).toBe('abcdef');
    expect(padLeft('abcdef', 3)).toBe('abcdef');
  });
});

describe('table', () => {
  it('lines the columns up', () => {
    const text = table([{ id: 't-1', gallons: 280 }], columns);
    const lines = text.split('\n');
    expect(lines[0]).toBe('tank  gallons');
    expect(lines[1]).toBe('----  -------');
    expect(lines[2]).toBe('t-1     280.0');
  });

  it('widens a column to fit its widest cell', () => {
    const text = table(
      [
        { id: 't-1', gallons: 280 },
        { id: 'tank-with-a-long-id', gallons: 5 },
      ],
      columns,
    );
    expect(text.split('\n')[0]?.startsWith('tank                 gallons')).toBe(true);
  });

  it('says so when there is nothing', () => {
    expect(table([], columns)).toBe('(nothing)');
  });

  it('does not leave trailing spaces on a row', () => {
    const text = table([{ id: 't-1', gallons: 1 }], [{ header: 'tank', get: (row) => row.id }]);
    expect(text.split('\n').every((line) => line === line.trimEnd())).toBe(true);
  });
});

describe('formatting helpers', () => {
  it('prints gallons to the tenth', () => {
    expect(gallons(212.349)).toBe('212.3');
    expect(gallons(0)).toBe('0.0');
  });

  it('prints a percent whole', () => {
    expect(percentOf(41.6)).toBe('42%');
  });
});
