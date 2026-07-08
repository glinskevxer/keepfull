import { afterEach, describe, expect, it } from 'vitest';
import { MemoryWriter } from '../../../src/cli/output';
import { buildProgram, defaultDeps, globalOptionsOf, run } from '../../../src/cli/program';
import { buildScenario } from '../../support/scenario';
import { cliDeps } from '../../support/cli';
import { closeTestDatabases } from '../../support/db';

afterEach(closeTestDatabases);

function inertDeps() {
  const writer = new MemoryWriter();
  return {
    writer,
    deps: {
      writer,
      runtime: () => {
        throw new Error('should not have opened a database');
      },
      settings: () => {
        throw new Error('should not have read the environment');
      },
    },
  };
}

describe('buildProgram', () => {
  it('names itself and carries the global flag', () => {
    const program = buildProgram(inertDeps().deps);
    expect(program.name()).toBe('keepfull');
    expect(program.options.map((option) => option.long)).toContain('--json');
  });

  it('registers every command group', () => {
    const names = buildProgram(inertDeps().deps)
      .commands.map((command) => command.name())
      .sort();
    for (const group of ['tanks', 'forecast', 'dispatch', 'weather', 'admin', 'jobs', 'budgets']) {
      expect(names).toContain(group);
    }
  });
});

describe('globalOptionsOf', () => {
  it('reads text by default and json when the flag is set', () => {
    const program = buildProgram(inertDeps().deps);
    expect(globalOptionsOf(program).format).toBe('text');
  });
});

describe('run', () => {
  it('exits zero on help without touching the environment', async () => {
    const { deps } = inertDeps();
    expect(await run(['--help'], deps)).toEqual({ code: 0 });
    expect(await run(['tanks', '--help'], deps)).toEqual({ code: 0 });
  });

  it('exits one on an unknown command', async () => {
    const { deps, writer } = inertDeps();
    expect(await run(['nonsense'], deps)).toEqual({ code: 1 });
    expect(writer.stderr.join('\n')).toMatch(/unknown command/i);
  });

  it('exits one on a missing argument', async () => {
    const { deps } = inertDeps();
    expect((await run(['tanks', 'show'], deps)).code).toBe(1);
  });

  it('exits two on a domain failure', async () => {
    const scenario = buildScenario({ today: '2026-07-10' });
    const { deps, writer } = cliDeps(scenario);
    expect(await run(['tanks', 'show', 't-nope'], deps)).toEqual({ code: 2 });
    expect(writer.stderr.join('\n')).toMatch(/not_found/);
  });

  it('exits one on something that is not a domain failure', async () => {
    const { writer } = inertDeps();
    const result = await run(['tanks', 'list'], {
      writer,
      runtime: () => {
        throw new TypeError('the wiring is wrong');
      },
      settings: () => {
        throw new Error('unused');
      },
    });
    expect(result.code).toBe(1);
    expect(writer.stderr.join('\n')).toMatch(/TypeError/);
  });
});

describe('defaultDeps', () => {
  it('does not read the environment until something asks', () => {
    const writer = new MemoryWriter();
    expect(() => defaultDeps(writer)).not.toThrow();
  });

  it('reports a bad environment when something does ask', () => {
    const deps = defaultDeps(new MemoryWriter());
    const before = process.env.YARD_LATITUDE;
    delete process.env.YARD_LATITUDE;
    try {
      expect(() => deps.settings()).toThrowError(/environment is not usable/);
    } finally {
      if (before !== undefined) {
        process.env.YARD_LATITUDE = before;
      }
    }
  });
});
