import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Reads what `npm audit` found and decides whether it should stop the build.
 *
 * `npm audit` exits non zero for anything at all, which on a project with a
 * build toolchain means it is red most weeks for something that never runs on
 * the yard machine. So the build asks two separate questions: are there
 * advisories against what actually ships, and are there advisories against the
 * toolchain. Only the first one fails.
 *
 * The second thing this has to handle is an advisory against a pinned version
 * with no fix inside the range we are willing to move to. Unpinning on a
 * Friday because a scanner went red is how the actual outage happens, so those
 * are read, judged against how this system is deployed, and written down in
 * `security-advisories.json` with a date. The gate then fails once that date
 * has passed, which is what stops an acceptance turning into a shrug.
 */

interface Advisory {
  readonly name: string;
  readonly severity: string;
  readonly via: unknown;
  readonly isDirect: boolean;
}

interface AuditReport {
  readonly vulnerabilities?: Record<string, Advisory>;
}

export interface Acceptance {
  readonly id: string;
  readonly package: string;
  readonly severity: string;
  readonly title: string;
  readonly acceptedOn: string;
  readonly reviewBy: string;
  readonly why: string;
}

export interface AuditVerdict {
  readonly total: number;
  readonly blocking: string[];
  readonly accepted: string[];
  readonly expired: string[];
  readonly bySeverity: Record<string, number>;
}

const BLOCKING = new Set(['high', 'critical']);

/** Pulls the advisory ids out of whatever shape npm nested them in. */
export function advisoryIds(advisory: Advisory): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object') {
      const url = (node as { url?: string }).url;
      const match = url ? /(GHSA-[\w-]+)/.exec(url) : null;
      if (match?.[1]) {
        found.push(match[1]);
      }
    }
  };
  walk(advisory.via);
  return found;
}

export function judge(
  report: AuditReport,
  accepted: readonly Acceptance[] = [],
  today = new Date().toISOString().slice(0, 10),
): AuditVerdict {
  const byId = new Map(accepted.map((entry) => [entry.id, entry]));
  const advisories = Object.values(report.vulnerabilities ?? {});
  const bySeverity: Record<string, number> = {};
  const blocking: string[] = [];
  const acceptedHere: string[] = [];
  const expired: string[] = [];

  for (const advisory of advisories) {
    bySeverity[advisory.severity] = (bySeverity[advisory.severity] ?? 0) + 1;
    if (!BLOCKING.has(advisory.severity)) {
      continue;
    }
    const ids = advisoryIds(advisory);
    // Only an advisory whose every id has been read and accepted passes, so a
    // package picking up a new advisory goes red even though its old ones are
    // on the register.
    const acceptances = ids.map((id) => byId.get(id));
    const unaccounted = ids.filter((id) => !byId.has(id));
    const stale = acceptances.filter(
      (entry): entry is Acceptance => entry !== undefined && entry.reviewBy < today,
    );

    if (ids.length === 0 || unaccounted.length > 0) {
      blocking.push(`${advisory.name} (${advisory.severity})`);
      continue;
    }
    if (stale.length > 0) {
      for (const entry of stale) {
        expired.push(`${entry.id} on ${entry.package}, due for review ${entry.reviewBy}`);
      }
      continue;
    }
    acceptedHere.push(`${advisory.name} (${advisory.severity}): ${ids.join(', ')}`);
  }

  return {
    total: advisories.length,
    blocking: blocking.sort(),
    accepted: acceptedHere.sort(),
    expired: expired.sort(),
    bySeverity,
  };
}

export function loadAcceptances(path: string): Acceptance[] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { accepted?: Acceptance[] };
    return parsed.accepted ?? [];
  } catch {
    return [];
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--from-audit');
  if (fileIndex < 0 || !args[fileIndex + 1]) {
    process.stderr.write('usage: audit-dependencies --from-audit <file> [--report-only]\n');
    process.exit(2);
  }
  const reportOnly = args.includes('--report-only');
  const path = args[fileIndex + 1] as string;

  let report: AuditReport;
  try {
    report = JSON.parse(readFileSync(path, 'utf8')) as AuditReport;
  } catch (error) {
    process.stderr.write(`could not read ${path}: ${(error as Error).message}\n`);
    process.exit(reportOnly ? 0 : 2);
    return;
  }

  const accepted = loadAcceptances(resolve(__dirname, '..', 'security-advisories.json'));
  const verdict = judge(report, accepted);
  const summary = Object.entries(verdict.bySeverity)
    .map(([severity, count]) => `${count} ${severity}`)
    .join(', ');
  process.stdout.write(
    verdict.total === 0 ? 'no advisories\n' : `${verdict.total} advisories: ${summary}\n`,
  );
  for (const entry of verdict.accepted) {
    process.stdout.write(`  accepted: ${entry}\n`);
  }
  for (const entry of verdict.blocking) {
    process.stdout.write(`  blocking: ${entry}\n`);
  }
  for (const entry of verdict.expired) {
    process.stdout.write(`  the acceptance has run out: ${entry}\n`);
  }

  if (reportOnly) {
    return;
  }
  if (verdict.expired.length > 0) {
    process.stderr.write(
      `${verdict.expired.length} accepted advisories are past their review date\n`,
    );
    process.exit(1);
  }
  if (verdict.blocking.length > 0) {
    process.stderr.write(`${verdict.blocking.length} advisories are high or worse\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
