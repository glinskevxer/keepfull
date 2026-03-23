import { describe, expect, it } from 'vitest';
import { renderReference, spliceInto } from '../../../scripts/build-command-reference';
import { MemoryWriter } from '../../../src/cli/output';
import { buildProgram } from '../../../src/cli/program';

function program() {
  return buildProgram({
    writer: new MemoryWriter(),
    runtime: () => {
      throw new Error('should not open a database');
    },
    settings: () => {
      throw new Error('should not read the environment');
    },
  });
}

describe('renderReference', () => {
  it('covers every top level command group', () => {
    const reference = renderReference(program());
    for (const group of ['tanks', 'forecast', 'dispatch', 'weather', 'admin', 'jobs', 'reports']) {
      expect(reference).toContain(`### \`keepfull ${group}\``);
    }
  });

  it('lists the subcommands in a table', () => {
    const reference = renderReference(program());
    expect(reference).toContain('| command | what it does |');
    expect(reference).toMatch(/\| `forecast due[^|]*` \| tanks due inside a window/);
  });

  it('carries the argument names a command takes', () => {
    expect(renderReference(program())).toMatch(/forecast tank \[options\] <tankId>/);
  });

  it('builds without opening a database', () => {
    expect(() => renderReference(program())).not.toThrow();
  });
});

describe('spliceInto', () => {
  const readme = 'before\n<!-- commands:start -->\nold\n<!-- commands:end -->\nafter\n';

  it('replaces only what is between the markers', () => {
    const result = spliceInto(readme, 'new');
    expect(result).toContain('before');
    expect(result).toContain('after');
    expect(result).toContain('new');
    expect(result).not.toContain('old');
  });

  it('is stable when run twice', () => {
    expect(spliceInto(spliceInto(readme, 'new'), 'new')).toBe(spliceInto(readme, 'new'));
  });

  it('refuses a readme with no markers', () => {
    expect(() => spliceInto('nothing here', 'new')).toThrowError(/needs a/);
  });

  it('refuses markers in the wrong order', () => {
    expect(() => spliceInto('<!-- commands:end -->\n<!-- commands:start -->', 'new')).toThrowError(
      /needs a/,
    );
  });
});
