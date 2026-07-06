import { MIGRATIONS } from '../src/db/migrations';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The things that are only ever wrong at the moment of shipping.
 *
 * Every one of these is here because it went wrong once. The migration
 * numbering check exists because two branches both added migration seven and
 * the second one to merge silently never ran. The pinned dependency check
 * exists because a caret on a patch version pulled in a change to how a date
 * parsed, on a Friday.
 */

export interface Problem {
  readonly check: string;
  readonly detail: string;
}

const root = resolve(__dirname, '..');

interface PackageJson {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  files?: string[];
}

export function checkVersion(pkg: PackageJson): Problem[] {
  if (!pkg.version || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    return [{ check: 'version', detail: `"${pkg.version ?? '(none)'}" is not a version` }];
  }
  return [];
}

/** Nothing that ships may float. A range is how a Friday gets ruined. */
export function checkPinnedDependencies(pkg: PackageJson): Problem[] {
  const problems: Problem[] = [];
  for (const [group, deps] of [
    ['dependencies', pkg.dependencies ?? {}],
    ['devDependencies', pkg.devDependencies ?? {}],
  ] as const) {
    for (const [name, range] of Object.entries(deps)) {
      if (!/^\d+\.\d+\.\d+$/.test(range)) {
        problems.push({ check: 'pinned dependencies', detail: `${group}.${name} is "${range}"` });
      }
    }
  }
  return problems;
}

/** Versions run one to n with nothing missing and nothing repeated. */
export function checkMigrationNumbering(
  versions: readonly number[],
  files: readonly string[],
): Problem[] {
  const problems: Problem[] = [];
  const sorted = [...versions].sort((left, right) => left - right);
  sorted.forEach((version, index) => {
    if (version !== index + 1) {
      problems.push({
        check: 'migration numbering',
        detail: `expected version ${index + 1} but found ${version}`,
      });
    }
  });
  if (files.length !== versions.length) {
    problems.push({
      check: 'migration numbering',
      detail: `${files.length} migration files but ${versions.length} in the index`,
    });
  }
  return problems;
}

export function checkScripts(pkg: PackageJson): Problem[] {
  const required = ['build', 'test', 'lint', 'typecheck', 'coverage'];
  return required
    .filter((name) => !(pkg.scripts ?? {})[name])
    .map((name) => ({ check: 'scripts', detail: `npm run ${name} is missing` }));
}

/** What `npm pack` would ship. Shipping the tests is how a secret escapes. */
export function checkFiles(pkg: PackageJson): Problem[] {
  const files = pkg.files ?? [];
  const problems: Problem[] = [];
  if (!files.includes('dist')) {
    problems.push({ check: 'files', detail: 'dist is not in the files list' });
  }
  for (const unwanted of ['tests', 'src', '.env']) {
    if (files.includes(unwanted)) {
      problems.push({ check: 'files', detail: `${unwanted} would be published` });
    }
  }
  return problems;
}

export function run(): Problem[] {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as PackageJson;
  const files = readdirSync(resolve(root, 'src/db/migrations')).filter((name) =>
    /^\d{4}-/.test(name),
  );
  return [
    ...checkVersion(pkg),
    ...checkPinnedDependencies(pkg),
    ...checkMigrationNumbering(
      MIGRATIONS.map((migration) => migration.version),
      files,
    ),
    ...checkScripts(pkg),
    ...checkFiles(pkg),
  ];
}

function main(): void {
  const problems = run();
  if (problems.length === 0) {
    process.stdout.write('release checks pass\n');
    return;
  }
  for (const problem of problems) {
    process.stderr.write(`${problem.check}: ${problem.detail}\n`);
  }
  process.stderr.write(`${problems.length} release checks failed\n`);
  process.exit(1);
}

if (require.main === module) {
  main();
}
