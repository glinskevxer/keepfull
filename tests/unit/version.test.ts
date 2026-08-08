import { afterEach, describe, expect, it } from 'vitest';
import { buildInfo, forgetBuildInfo, shortCommit } from '../../src/version';

afterEach(forgetBuildInfo);

describe('shortCommit', () => {
  it('takes the first seven characters', () => {
    expect(shortCommit('a1b2c3d4e5f6')).toBe('a1b2c3d');
  });

  it('lowercases it', () => {
    expect(shortCommit('A1B2C3D4E5F6')).toBe('a1b2c3d');
  });

  it('is nothing when the build did not set one', () => {
    expect(shortCommit(undefined)).toBeNull();
    expect(shortCommit('')).toBeNull();
  });

  it('refuses something that is not a commit', () => {
    expect(shortCommit('not-a-commit')).toBeNull();
    expect(shortCommit('abc')).toBeNull();
  });
});

describe('buildInfo', () => {
  it('reads the name and version out of the package', () => {
    const info = buildInfo({} as NodeJS.ProcessEnv);
    expect(info.name).toBe('keepfull');
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reports the node it is running on', () => {
    expect(buildInfo({} as NodeJS.ProcessEnv).node).toBe(process.version);
  });

  it('carries the commit and build time when the build set them', () => {
    const info = buildInfo({
      GIT_COMMIT: 'a1b2c3d4e5f6',
      BUILT_AT: '2026-08-07T10:00:00Z',
    } as NodeJS.ProcessEnv);
    expect(info.commit).toBe('a1b2c3d');
    expect(info.builtAt).toBe('2026-08-07T10:00:00Z');
  });

  it('is content with neither, which is how a checkout runs', () => {
    const info = buildInfo({} as NodeJS.ProcessEnv);
    expect(info.commit).toBeNull();
    expect(info.builtAt).toBeNull();
  });

  it('caches the real environment but not an injected one', () => {
    const first = buildInfo();
    expect(buildInfo()).toBe(first);
    expect(buildInfo({} as NodeJS.ProcessEnv)).not.toBe(first);
  });
});
