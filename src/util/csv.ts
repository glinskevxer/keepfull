import { assertNonEmpty } from './assert';

/**
 * A comma separated reader and writer, written here rather than pulled in.
 *
 * Everything that arrives from outside this system arrives as a csv: the
 * nightly temperature extract from the weather service, the ticket file the
 * handhelds dump at end of shift, the tank monitor vendor's daily reading
 * export. All three quote inconsistently and one of them still emits a byte
 * order mark, so the parser has to be forgiving in exactly the ways those
 * three files need and strict everywhere else.
 */

export interface CsvOptions {
  readonly delimiter?: string;
  readonly trim?: boolean;
}

export function parseCsv(text: string, options: CsvOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ',';
  if (delimiter.length !== 1) {
    throw new Error('the delimiter has to be a single character');
  }
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let index = 0;
  let sawAnything = false;

  while (index < source.length) {
    const character = source[index] as string;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }
    if (character === '"' && field === '') {
      quoted = true;
      sawAnything = true;
      index += 1;
      continue;
    }
    if (character === delimiter) {
      row.push(options.trim === false ? field : field.trim());
      field = '';
      sawAnything = true;
      index += 1;
      continue;
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') {
        index += 1;
      }
      row.push(options.trim === false ? field : field.trim());
      if (row.length > 1 || (row[0] as string).length > 0 || sawAnything) {
        rows.push(row);
      }
      row = [];
      field = '';
      sawAnything = false;
      index += 1;
      continue;
    }
    field += character;
    sawAnything = true;
    index += 1;
  }

  if (quoted) {
    throw new Error('the file ends inside a quoted field');
  }
  if (sawAnything || row.length > 0) {
    row.push(options.trim === false ? field : field.trim());
    rows.push(row);
  }
  return rows;
}

export interface CsvTable {
  readonly headers: string[];
  readonly rows: Record<string, string>[];
}

/** Reads the first line as headers and hands back rows keyed by header name. */
export function parseCsvTable(text: string, options: CsvOptions = {}): CsvTable {
  const raw = parseCsv(text, options);
  const [header, ...rest] = raw;
  if (!header) {
    return { headers: [], rows: [] };
  }
  const headers = header.map((name) => name.toLowerCase());
  const seen = new Set<string>();
  for (const name of headers) {
    if (seen.has(name)) {
      throw new Error(`the header "${name}" appears twice`);
    }
    seen.add(name);
  }
  const rows = rest.map((values, offset) => {
    if (values.length !== headers.length) {
      throw new Error(
        `row ${offset + 2} has ${values.length} fields against ${headers.length} headers`,
      );
    }
    const record: Record<string, string> = {};
    headers.forEach((name, position) => {
      record[name] = values[position] as string;
    });
    return record;
  });
  return { headers, rows };
}

export function requireColumn(row: Record<string, string>, name: string): string {
  const value = row[name];
  if (value === undefined) {
    throw new Error(`the row has no column called "${name}"`);
  }
  return assertNonEmpty(value, name);
}

export function optionalColumn(row: Record<string, string>, name: string): string | undefined {
  const value = row[name];
  return value === undefined || value.trim() === '' ? undefined : value;
}

function escapeField(value: string, delimiter: string): string {
  if (value.includes('"') || value.includes(delimiter) || /[\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function writeCsv(rows: readonly (readonly string[])[], options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ',';
  return rows
    .map((row) => row.map((field) => escapeField(field, delimiter)).join(delimiter))
    .join('\n');
}

export function writeCsvTable(
  headers: readonly string[],
  rows: readonly Record<string, string>[],
  options: CsvOptions = {},
): string {
  const body = rows.map((row) => headers.map((name) => row[name] ?? ''));
  return writeCsv([[...headers], ...body], options);
}
