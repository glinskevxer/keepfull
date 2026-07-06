import { describe, expect, it } from 'vitest';
import {
  checkFiles,
  checkMigrationNumbering,
  checkPinnedDependencies,
  checkScripts,
  checkVersion,
  run,
} from '../../../scripts/release-check';

describe('checkVersion', () => {
  it('accepts a plain three part version', () => {
    expect(checkVersion({ version: '1.2.3' })).toEqual([]);
  });

  it('refuses anything else', () => {
    expect(checkVersion({ version: '1.2' })).toHaveLength(1);
    expect(checkVersion({})).toHaveLength(1);
    expect(checkVersion({ version: '1.2.3-beta' })).toHaveLength(1);
  });
});

describe('checkPinnedDependencies', () => {
  it('is happy with exact versions', () => {
    expect(
      checkPinnedDependencies({ dependencies: { zod: '3.24.1' }, devDependencies: {} }),
    ).toEqual([]);
  });

  it('names anything that floats', () => {
    const problems = checkPinnedDependencies({
      dependencies: { zod: '^3.24.1' },
      devDependencies: { vitest: '~2.1.9' },
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]?.detail).toMatch(/dependencies.zod is "\^3.24.1"/);
  });

  it('catches a tag as well as a range', () => {
    expect(checkPinnedDependencies({ dependencies: { a: 'latest' } })).toHaveLength(1);
  });
});

describe('checkMigrationNumbering', () => {
  it('is happy with one to n', () => {
    expect(checkMigrationNumbering([1, 2, 3], ['a', 'b', 'c'])).toEqual([]);
  });

  it('spots a gap', () => {
    const problems = checkMigrationNumbering([1, 3], ['a', 'b']);
    expect(problems[0]?.detail).toMatch(/expected version 2 but found 3/);
  });

  it('spots a file the index forgot', () => {
    const problems = checkMigrationNumbering([1, 2], ['a', 'b', 'c']);
    expect(problems.some((problem) => problem.detail.includes('3 migration files'))).toBe(true);
  });

  it('spots a repeat', () => {
    expect(checkMigrationNumbering([1, 1], ['a', 'b']).length).toBeGreaterThan(0);
  });
});

describe('checkScripts and checkFiles', () => {
  it('names a missing script', () => {
    const problems = checkScripts({ scripts: { build: 'tsc' } });
    expect(problems.map((problem) => problem.detail)).toContain('npm run test is missing');
  });

  it('insists dist is published', () => {
    expect(checkFiles({ files: ['README.md'] })[0]?.detail).toMatch(/dist is not/);
  });

  it('refuses to publish the tests or the sources', () => {
    const problems = checkFiles({ files: ['dist', 'tests', 'src'] });
    expect(problems).toHaveLength(2);
  });
});

describe('the real package', () => {
  it('passes every release check', () => {
    expect(run()).toEqual([]);
  });
});
