/**
 * How the cli prints.
 *
 * Two shapes, chosen by a flag rather than by guessing at a tty. Text is for
 * somebody reading it, and json is for the cron jobs that pipe this into other
 * things. Guessing off `isTTY` means the output changes when somebody adds a
 * `| less`, which has bitten this yard before with a different tool.
 */

export interface Writer {
  out(line: string): void;
  err(line: string): void;
}

export const processWriter: Writer = {
  out(line) {
    process.stdout.write(`${line}\n`);
  },
  err(line) {
    process.stderr.write(`${line}\n`);
  },
};

export class MemoryWriter implements Writer {
  readonly stdout: string[] = [];
  readonly stderr: string[] = [];

  out(line: string): void {
    this.stdout.push(line);
  }

  err(line: string): void {
    this.stderr.push(line);
  }

  get text(): string {
    return this.stdout.join('\n');
  }
}

export type Format = 'text' | 'json';

export function emit(writer: Writer, format: Format, value: unknown, text: () => string): void {
  if (format === 'json') {
    writer.out(JSON.stringify(value, null, 2));
    return;
  }
  writer.out(text());
}

/** Pads a column so the output lines up without pulling in a table library. */
export function padTo(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

export function padLeft(value: string, width: number): string {
  return value.length >= width ? value : ' '.repeat(width - value.length) + value;
}

export interface Column<T> {
  readonly header: string;
  readonly get: (row: T) => string;
  readonly align?: 'left' | 'right';
}

export function table<T>(rows: readonly T[], columns: readonly Column<T>[]): string {
  if (rows.length === 0) {
    return '(nothing)';
  }
  const widths = columns.map((column) =>
    Math.max(column.header.length, ...rows.map((row) => column.get(row).length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) =>
        columns[index]?.align === 'right'
          ? padLeft(cell, widths[index] as number)
          : padTo(cell, widths[index] as number),
      )
      .join('  ')
      .trimEnd();
  const header = line(columns.map((column) => column.header));
  const rule = widths.map((width) => '-'.repeat(width)).join('  ');
  const body = rows.map((row) => line(columns.map((column) => column.get(row))));
  return [header, rule, ...body].join('\n');
}

export function gallons(value: number): string {
  return value.toFixed(1);
}

export function percentOf(value: number): string {
  return `${value.toFixed(0)}%`;
}
