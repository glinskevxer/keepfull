import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * What is actually running.
 *
 * The version comes out of package.json rather than being written into a
 * constant, because a constant is a second place to remember and it was wrong
 * for two releases. The commit comes from the environment, set by whatever
 * builds the image, and is deliberately optional: a developer running from a
 * checkout has no build to take it from and should not have to fake one.
 *
 * This is on the index and on `/ready` because the question it answers is
 * always asked in the same breath as "is it up": somebody has deployed and
 * wants to know whether what is running is what they deployed.
 */

export interface BuildInfo {
  readonly name: string;
  readonly version: string;
  readonly commit: string | null;
  readonly builtAt: string | null;
  readonly node: string;
}

let cached: BuildInfo | undefined;

export function buildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  if (cached && env === process.env) {
    return cached;
  }
  const info: BuildInfo = {
    ...readPackage(),
    commit: shortCommit(env.GIT_COMMIT),
    builtAt: env.BUILT_AT ?? null,
    node: process.version,
  };
  if (env === process.env) {
    cached = info;
  }
  return info;
}

/** Seven characters is what anybody reads off a commit, and all they need. */
export function shortCommit(value: string | undefined): string | null {
  if (!value || !/^[0-9a-f]{7,40}$/i.test(value)) {
    return null;
  }
  return value.slice(0, 7).toLowerCase();
}

function readPackage(): { name: string; version: string } {
  // Two candidates: the source tree during development, and one directory up
  // from dist once it is built. Neither is worth failing over.
  for (const path of [
    resolve(__dirname, '..', 'package.json'),
    resolve(__dirname, '..', '..', 'package.json'),
  ]) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { name?: string; version?: string };
      if (parsed.name && parsed.version) {
        return { name: parsed.name, version: parsed.version };
      }
    } catch {
      continue;
    }
  }
  return { name: 'keepfull', version: '0.0.0' };
}

/** Clears the cache, which only the tests need. */
export function forgetBuildInfo(): void {
  cached = undefined;
}
