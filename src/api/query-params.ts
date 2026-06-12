import { DayKey, dayKey } from '../util/dates';

/**
 * Turning query strings into repository filters.
 *
 * Every list endpoint had grown the same shape:
 *
 *     context.deliveries.list({
 *       ...(query.tankId ? { tankId: query.tankId } : {}),
 *       ...(query.from ? { from: dayKey(query.from) } : {}),
 *       ...
 *     })
 *
 * That is there because `exactOptionalPropertyTypes` refuses an explicit
 * `undefined` on an optional field, and each spread is a small conditional
 * nobody reads carefully. Two of them had the condition inverted for a boolean
 * flag, so `openOnly=false` filtered as though it were true.
 *
 * `defined` does the same job once: build the object plainly with `undefined`
 * for what is absent, and drop those keys on the way out.
 */

/**
 * The same fields, each optional and none of them ever holding `undefined`.
 * `Partial<T>` is not enough: under `exactOptionalPropertyTypes` a value of
 * `string | undefined` is still refused where the target says `string`.
 */
export type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/** Drops every key whose value is undefined. */
export function defined<T extends Record<string, unknown>>(input: T): Defined<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as Defined<T>;
}

/** A day from a query string, or undefined when it was not given. */
export function optionalDay(value: string | undefined): DayKey | undefined {
  return value === undefined || value === '' ? undefined : dayKey(value);
}

/**
 * A flag from a query string. Only the literal `true` is true, so a caller
 * sending `openOnly=false` gets what they asked for rather than the opposite.
 */
export function flag(value: string | undefined): true | undefined {
  return value === 'true' ? true : undefined;
}

export function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`"${value}" is not a number`);
  }
  return parsed;
}

export function optionalText(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/** A comma separated list, with the blanks dropped. */
export function optionalList(value: string | undefined): string[] | undefined {
  const text = optionalText(value);
  if (text === undefined) {
    return undefined;
  }
  const parts = text
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return parts.length === 0 ? undefined : parts;
}
