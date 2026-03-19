import { readFileSync } from 'node:fs';

/**
 * Reads what `npm audit` found and decides whether it should stop the build.
 *
 * `npm audit` exits non zero for anything at all, which on a project with a
 * build toolchain means it is red most weeks for something that never runs on
 * the yard machine. So the build asks two separate questions: are there
 * advisories against what actually ships, and are there advisories against the
 * toolchain. Only the first one fails.
 */

interface Advisory {
  readonly name: string;
  readonly severity: string;
  readonly via: unknown;
  readonly isDirect: boolean;
}

interface AuditReport {
  readonly vulnerabilities?: Record<string, Advisory>;
  readonly metadata?: { vulnerabilities?: Record<string, number> };
}

const BLOCKING = new Set(['high', 'critical']);

export interface AuditVerdict {
  readonly total: number;
  readonly blocking: string[];
  readonly bySeverity: Record<string, number>;
}

export function judge(report: AuditReport): AuditVerdict {
  const advisories = Object.values(report.vulnerabilities ?? {});
  const bySeverity: Record<string, number> = {};
  const blocking: string[] = [];
  for (const advisory of advisories) {
    bySeverity[advisory.severity] = (bySeverity[advisory.severity] ?? 0) + 1;
    if (BLOCKING.has(advisory.severity)) {
      blocking.push(`${advisory.name} (${advisory.severity})`);
    }
  }
  return { total: advisories.length, blocking: blocking.sort(), bySeverity };
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

  const verdict = judge(report);
  const summary = Object.entries(verdict.bySeverity)
    .map(([severity, count]) => `${count} ${severity}`)
    .join(', ');
  process.stdout.write(
    verdict.total === 0 ? 'no advisories\n' : `${verdict.total} advisories: ${summary}\n`,
  );
  for (const entry of verdict.blocking) {
    process.stdout.write(`  ${entry}\n`);
  }
  if (!reportOnly && verdict.blocking.length > 0) {
    process.stderr.write(`${verdict.blocking.length} advisories are high or worse\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
