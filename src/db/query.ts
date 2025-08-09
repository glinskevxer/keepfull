/**
 * A very small where clause builder.
 *
 * Four repositories had grown the same twenty lines: start an array of clauses,
 * start an object of parameters, push a pair for every filter that was set,
 * then join with AND and remember that an empty array must not produce the word
 * WHERE. Two of the four had already drifted, one of them putting the limit in
 * the wrong place so `count` quietly honoured a page size.
 *
 * This is not an attempt at an object relational mapper. It builds a where
 * clause and it holds the parameters that go with it, and every repository
 * still writes its own sql around it.
 */
export class WhereClause {
  private readonly clauses: string[] = [];
  private readonly params: Record<string, unknown> = {};

  /** Adds `column = @name` when the value is set, and nothing when it is not. */
  eq(column: string, name: string, value: unknown): this {
    if (value !== undefined && value !== null) {
      this.clauses.push(`${column} = @${name}`);
      this.params[name] = value;
    }
    return this;
  }

  gte(column: string, name: string, value: unknown): this {
    if (value !== undefined && value !== null) {
      this.clauses.push(`${column} >= @${name}`);
      this.params[name] = value;
    }
    return this;
  }

  lte(column: string, name: string, value: unknown): this {
    if (value !== undefined && value !== null) {
      this.clauses.push(`${column} <= @${name}`);
      this.params[name] = value;
    }
    return this;
  }

  /** Adds a clause with no parameter, when a flag is on. */
  when(flag: boolean | undefined, clause: string): this {
    if (flag) {
      this.clauses.push(clause);
    }
    return this;
  }

  /** The `WHERE ...` text, or an empty string when nothing was added. */
  get sql(): string {
    return this.clauses.length === 0 ? '' : `WHERE ${this.clauses.join(' AND ')}`;
  }

  get isEmpty(): boolean {
    return this.clauses.length === 0;
  }

  /** The parameters, plus whatever else the caller needs bound. */
  bind(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...this.params, ...extra };
  }
}

/** sqlite treats a negative limit as no limit, which is what an absent page size means. */
export function limitOf(limit: number | undefined): number {
  return limit === undefined || limit < 0 ? -1 : limit;
}
