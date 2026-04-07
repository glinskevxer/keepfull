import { afterEach, describe, expect, it } from 'vitest';
import {
  ignoreRow,
  item,
  problemLines,
  runImport,
  skipRow,
  summaryLine,
} from '../../../src/cli/import-runner';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop() as string, { recursive: true, force: true });
  }
});

function fileWith(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'keepfull-import-'));
  dirs.push(dir);
  const path = join(dir, 'in.csv');
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('runImport', () => {
  it('reads every row and writes them in one go', () => {
    const written: string[] = [];
    const outcome = runImport<string>({
      file: fileWith('name\na\nb\n'),
      dryRun: false,
      subjectOf: (row) => `name ${row.name}`,
      readRow: (row) => item(row.name as string),
      write(items) {
        written.push(...items);
        return items.length;
      },
    });
    expect(outcome).toMatchObject({ read: 2, usable: 2, written: 2, skipped: 0 });
    expect(written).toEqual(['a', 'b']);
  });

  it('numbers a problem from the header, so line two is the first row', () => {
    const outcome = runImport<string>({
      file: fileWith('name\na\nbad\n'),
      dryRun: false,
      subjectOf: (row) => `name ${row.name}`,
      readRow(row) {
        if (row.name === 'bad') {
          throw new Error('nope');
        }
        return item(row.name as string);
      },
      write: (items) => items.length,
    });
    expect(outcome.problems).toEqual([{ line: 3, subject: 'name bad', reason: 'Error: nope' }]);
  });

  it('counts a skipped row apart from an ignored one', () => {
    const outcome = runImport<string>({
      file: fileWith('name\nkeep\nskip\nignore\n'),
      dryRun: false,
      subjectOf: (row) => `name ${row.name}`,
      readRow(row) {
        if (row.name === 'skip') {
          return skipRow;
        }
        if (row.name === 'ignore') {
          return ignoreRow;
        }
        return item(row.name as string);
      },
      write: (items) => items.length,
    });
    expect(outcome).toMatchObject({ read: 3, usable: 1, written: 1, skipped: 1 });
  });

  it('writes nothing on a dry run but still reports what it would have', () => {
    let called = 0;
    const outcome = runImport<string>({
      file: fileWith('name\na\n'),
      dryRun: true,
      subjectOf: () => 'row',
      readRow: (row) => item(row.name as string),
      write() {
        called += 1;
        return 1;
      },
    });
    expect(outcome.usable).toBe(1);
    expect(outcome.written).toBe(0);
    expect(called).toBe(0);
  });

  it('records a per row write failure against its own line', () => {
    const outcome = runImport<string>({
      file: fileWith('name\na\nboom\nc\n'),
      dryRun: false,
      subjectOf: (row) => `name ${row.name}`,
      readRow: (row) => item(row.name as string),
      writeOne(value) {
        if (value === 'boom') {
          throw new Error('cannot write that');
        }
      },
    });
    expect(outcome.written).toBe(2);
    expect(outcome.problems).toEqual([
      { line: 3, subject: 'name boom', reason: 'Error: cannot write that' },
    ]);
  });

  it('keeps the problems in line order however they arose', () => {
    const outcome = runImport<string>({
      file: fileWith('name\nbadwrite\nbadread\n'),
      dryRun: false,
      subjectOf: (row) => `name ${row.name}`,
      readRow(row) {
        if (row.name === 'badread') {
          throw new Error('read');
        }
        return item(row.name as string);
      },
      writeOne() {
        throw new Error('write');
      },
    });
    expect(outcome.problems.map((problem) => problem.line)).toEqual([2, 3]);
  });

  it('handles a file with headers and nothing else', () => {
    const outcome = runImport<string>({
      file: fileWith('name\n'),
      dryRun: false,
      subjectOf: () => 'row',
      readRow: (row) => item(row.name as string),
      write: (items) => items.length,
    });
    expect(outcome).toMatchObject({ read: 0, usable: 0, written: 0 });
  });
});

describe('summaryLine and problemLines', () => {
  const outcome = {
    file: 'x.csv',
    read: 4,
    usable: 2,
    written: 2,
    skipped: 1,
    problems: [
      { line: 3, subject: 'a', reason: 'one' },
      { line: 4, subject: 'b', reason: 'two' },
    ],
    items: [],
    dryRun: false,
  };

  it('reads the same way for every import', () => {
    expect(summaryLine(outcome)).toBe('4 rows read, 2 usable, 1 already on file, 2 written');
  });

  it('leaves the skipped clause off when nothing was skipped', () => {
    expect(summaryLine({ ...outcome, skipped: 0 })).toBe('4 rows read, 2 usable, 2 written');
  });

  it('marks a dry run', () => {
    expect(summaryLine({ ...outcome, dryRun: true })).toMatch(/\(dry run\)$/);
  });

  it('takes a different noun', () => {
    expect(summaryLine(outcome, 'tickets')).toMatch(/^4 tickets read/);
  });

  it('indents the problem lines and caps them', () => {
    expect(problemLines(outcome)).toEqual(['  line 3 a: one', '  line 4 b: two']);
    expect(problemLines(outcome, 1)).toHaveLength(1);
  });
});
