import { describeError } from '../core/errors';
import { parseCsvTable } from '../util/csv';
import { readFileSync } from 'node:fs';

/**
 * The shape every csv import here has.
 *
 * Three commands had grown the same forty lines: read the file, parse it, walk
 * the rows keeping track of which line each came from, catch per row so one bad
 * row does not cost the file, count what happened, and print a summary with the
 * bad lines underneath. They had drifted in two ways that mattered. The weather
 * import numbered its problem lines from the header and the ticket import
 * numbered them from the first data row, so the same complaint pointed at two
 * different lines depending on which file it came from. And only one of the
 * three actually honoured its own dry run flag on every path.
 */

export interface ImportProblem {
  /** Line in the file, counting the header as line one. */
  readonly line: number;
  readonly subject: string;
  readonly reason: string;
}

export interface ImportOutcome<T> {
  readonly file: string;
  readonly read: number;
  /** Rows that produced something to write. */
  readonly usable: number;
  /** Rows written, which is zero on a dry run. */
  readonly written: number;
  /** Rows deliberately passed over, such as one already on file. */
  readonly skipped: number;
  readonly problems: ImportProblem[];
  readonly items: T[];
  readonly dryRun: boolean;
}

/** What a row turned into: something to write, something to skip, or nothing. */
export type RowResult<T> = { kind: 'item'; item: T } | { kind: 'skip' } | { kind: 'ignore' };

export function item<T>(value: T): RowResult<T> {
  return { kind: 'item', item: value };
}

export const skipRow: RowResult<never> = { kind: 'skip' };
export const ignoreRow: RowResult<never> = { kind: 'ignore' };

export interface ImportSpec<T> {
  readonly file: string;
  readonly dryRun: boolean;
  /** Names the row in a problem line, before the row has been understood. */
  subjectOf(row: Record<string, string>): string;
  /** Turns one row into something to write, or throws to record a problem. */
  readRow(row: Record<string, string>, line: number): RowResult<T>;
  /**
   * Writes everything the file produced, in one go. Use this when the write
   * cannot fail per row, such as an upsert into one table.
   */
  write?(items: readonly T[]): number;
  /**
   * Writes one row, which may fail on its own. A failure here is recorded
   * against its line exactly like a parse failure, because from the yard's
   * point of view "the tank is not on file" and "the tank column is blank" are
   * the same kind of problem with the same fix.
   */
  writeOne?(item: T, line: number): void;
}

export function runImport<T>(spec: ImportSpec<T>): ImportOutcome<T> {
  const parsed = parseCsvTable(readFileSync(spec.file, 'utf8'));
  const problems: ImportProblem[] = [];
  const staged: { line: number; subject: string; item: T }[] = [];
  let skipped = 0;

  parsed.rows.forEach((row, index) => {
    // The header is line one, so the first data row is line two. Every import
    // counts this the same way now.
    const line = index + 2;
    const subject = spec.subjectOf(row);
    try {
      const result = spec.readRow(row, line);
      if (result.kind === 'item') {
        staged.push({ line, subject, item: result.item });
      } else if (result.kind === 'skip') {
        skipped += 1;
      }
    } catch (error) {
      problems.push({ line, subject, reason: describeError(error) });
    }
  });

  const items = staged.map((entry) => entry.item);
  let written = 0;
  if (!spec.dryRun) {
    if (spec.writeOne) {
      for (const entry of staged) {
        try {
          spec.writeOne(entry.item, entry.line);
          written += 1;
        } catch (error) {
          problems.push({
            line: entry.line,
            subject: entry.subject,
            reason: describeError(error),
          });
        }
      }
    } else if (spec.write) {
      written = spec.write(items);
    }
  }

  return {
    file: spec.file,
    read: parsed.rows.length,
    usable: items.length,
    written,
    skipped,
    problems: problems.sort((left, right) => left.line - right.line),
    items,
    dryRun: spec.dryRun,
  };
}

/** The first line of every import summary, in one place so they all match. */
export function summaryLine(outcome: ImportOutcome<unknown>, noun = 'rows'): string {
  const parts = [`${outcome.read} ${noun} read`, `${outcome.usable} usable`];
  if (outcome.skipped > 0) {
    parts.push(`${outcome.skipped} already on file`);
  }
  parts.push(`${outcome.written} written`);
  return parts.join(', ') + (outcome.dryRun ? ' (dry run)' : '');
}

export function problemLines(outcome: ImportOutcome<unknown>, limit = 20): string[] {
  return outcome.problems
    .slice(0, limit)
    .map((problem) => `  line ${problem.line} ${problem.subject}: ${problem.reason}`);
}
