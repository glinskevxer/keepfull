import { Command } from 'commander';
import { MemoryWriter } from '../src/cli/output';
import { buildProgram } from '../src/cli/program';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Regenerates the command reference in the readme from the program itself.
 *
 * The reference went stale within a fortnight the first time it was written by
 * hand, and a stale reference is worse than none because people trust it. CI
 * runs this with `--check` and fails if what is in the readme is not what the
 * cli would print.
 */

const START = '<!-- commands:start -->';
const END = '<!-- commands:end -->';

export function renderReference(program: Command): string {
  const lines: string[] = [];
  for (const command of program.commands) {
    lines.push(`### \`keepfull ${command.name()}\``);
    lines.push('');
    lines.push(command.description());
    lines.push('');
    const children = command.commands;
    if (children.length === 0) {
      continue;
    }
    lines.push('| command | what it does |');
    lines.push('| --- | --- |');
    for (const child of children) {
      const usage = `${command.name()} ${child.name()} ${child.usage()}`.trim();
      lines.push(`| \`${usage}\` | ${child.description()} |`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function spliceInto(readme: string, reference: string): string {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`the readme needs a ${START} and ${END} pair`);
  }
  return `${readme.slice(0, start + START.length)}\n\n${reference}\n\n${readme.slice(end)}`;
}

function main(): void {
  const check = process.argv.includes('--check');
  const path = resolve(__dirname, '..', 'README.md');
  const writer = new MemoryWriter();
  const program = buildProgram({
    writer,
    runtime: () => {
      throw new Error('the reference must not open a database');
    },
    settings: () => {
      throw new Error('the reference must not read the environment');
    },
  });
  const current = readFileSync(path, 'utf8');
  const updated = spliceInto(current, renderReference(program));

  if (check) {
    if (current !== updated) {
      process.stderr.write(
        'the command reference in README.md is out of date, run npm run commands\n',
      );
      process.exit(1);
    }
    process.stdout.write('the command reference matches the cli\n');
    return;
  }
  writeFileSync(path, updated, 'utf8');
  process.stdout.write('rewrote the command reference in README.md\n');
}

if (require.main === module) {
  main();
}
