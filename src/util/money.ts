import { assertFinite, assertInteger, assertNonEmpty, assertPositive } from './assert';

/**
 * Money is never a float here.
 *
 * Two different scales are in play and they are not interchangeable. An invoice
 * line is whole cents. A posted price per gallon is quoted to the tenth of a
 * cent, because two dollars forty nine and nine tenths is a real price and
 * rounding it to $2.50 across a two thousand gallon commercial fill is fifty
 * cents of nothing that anybody agreed to.
 */

/** Whole cents. What ends up on an invoice. */
export type Cents = number & { readonly __cents: unique symbol };
/** Tenths of a cent, so 24990 is $2.4990 per gallon. */
export type Mills = number & { readonly __mills: unique symbol };

export function cents(value: number): Cents {
  assertInteger(value, 'cents');
  return value as Cents;
}

export function mills(value: number): Mills {
  assertInteger(value, 'mills');
  return value as Mills;
}

const MONEY_PATTERN = /^-?\$?\d+(\.\d+)?$/;

export function parseCents(text: string): Cents {
  assertNonEmpty(text, 'amount');
  const cleaned = text.trim().replace(/,/g, '');
  if (!MONEY_PATTERN.test(cleaned)) {
    throw new Error(`"${text}" is not an amount of money`);
  }
  const negative = cleaned.startsWith('-');
  const digits = cleaned.replace(/[-$]/g, '');
  const [whole = '0', fraction = ''] = digits.split('.');
  if (fraction.length > 2) {
    throw new Error(`"${text}" has more precision than a cent`);
  }
  const padded = fraction.padEnd(2, '0');
  const total = Number(whole) * 100 + Number(padded);
  return cents(negative ? -total : total);
}

export function parseMills(text: string): Mills {
  assertNonEmpty(text, 'price');
  const cleaned = text.trim().replace(/[,$]/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    throw new Error(`"${text}" is not a price`);
  }
  const [whole = '0', fraction = ''] = cleaned.split('.');
  if (fraction.length > 4) {
    throw new Error(`"${text}" is quoted finer than a tenth of a cent`);
  }
  const padded = fraction.padEnd(4, '0');
  return mills(Number(whole) * 10_000 + Number(padded));
}

export function formatCents(value: Cents): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${whole.toLocaleString('en-US')}.${rest}`;
}

export function formatMills(value: Mills): string {
  const whole = Math.floor(value / 10_000);
  const rest = String(value % 10_000).padStart(4, '0');
  return `$${whole}.${rest}`;
}

/** Round half away from zero, which is what the billing clerk does by hand. */
export function roundHalfUp(value: number): number {
  assertFinite(value, 'amount');
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Extend a price per gallon over a number of gallons, landing on whole cents. */
export function extend(gallons: number, price: Mills): Cents {
  assertFinite(gallons, 'gallons');
  return cents(roundHalfUp((gallons * price) / 100));
}

export function addCents(...values: Cents[]): Cents {
  return cents(values.reduce((total, value) => total + value, 0));
}

export function subtractCents(left: Cents, right: Cents): Cents {
  return cents(left - right);
}

/** Applies a percentage, such as a state excise rate, rounding to the cent. */
export function percentOf(amount: Cents, rate: number): Cents {
  assertFinite(rate, 'rate');
  return cents(roundHalfUp((amount * rate) / 100));
}

/**
 * Splits an amount across shares so the parts add back to the whole. Used for
 * budget plans, where eleven equal payments and a true up have to reconcile to
 * the penny.
 */
export function allocate(amount: Cents, shares: number): Cents[] {
  assertPositive(shares, 'shares');
  assertInteger(shares, 'shares');
  const base = Math.trunc(amount / shares);
  const parts = Array.from({ length: shares }, () => base);
  let remainder = amount - base * shares;
  const step = remainder < 0 ? -1 : 1;
  let index = 0;
  while (remainder !== 0) {
    parts[index] = (parts[index] as number) + step;
    remainder -= step;
    index = (index + 1) % shares;
  }
  return parts.map((part) => cents(part));
}
