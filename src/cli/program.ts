import { Command } from 'commander';
import { Format, Writer, processWriter } from './output';
import { Runtime, boot } from '../bootstrap';
import { Settings, loadSettings } from '../config/env';
import { describeError, isDomainError } from '../core/errors';
import { registerAdminCommands } from './commands/admin';
import { registerDispatchCommands } from './commands/dispatch';
import { registerForecastCommands } from './commands/forecast';
import { registerJobCommands } from './commands/jobs';
import { registerLoadCommands } from './commands/loads';
import { registerReportCommands } from './commands/reports';
import { registerSizingCommands } from './commands/sizing';
import { registerTankCommands } from './commands/tanks';
import { registerWeatherCommands } from './commands/weather';

/**
 * The command line the yard actually uses.
 *
 * The office has a web screen, but the two people who know this system best
 * work from a terminal and everything the nightly cron does runs through here
 * too. So the cli is not a debugging afterthought; it reaches the same services
 * the api does, through the same context.
 */

export interface CliDeps {
  readonly writer: Writer;
  /** Built lazily so `--help` does not open a database. */
  readonly runtime: () => Runtime;
  readonly settings: () => Settings;
}

export interface GlobalOptions {
  readonly format: Format;
}

export function globalOptionsOf(command: Command): GlobalOptions {
  const options = command.optsWithGlobals() as { json?: boolean };
  return { format: options.json ? 'json' : 'text' };
}

export function buildProgram(deps: CliDeps): Command {
  const program = new Command();
  program
    .name('keepfull')
    .description('delivery forecasting and dispatch for a bulk propane dealer')
    .option('--json', 'print machine readable output instead of a table', false)
    .showHelpAfterError()
    .exitOverride();

  registerTankCommands(program, deps);
  registerForecastCommands(program, deps);
  registerDispatchCommands(program, deps);
  registerWeatherCommands(program, deps);
  registerAdminCommands(program, deps);
  registerJobCommands(program, deps);
  registerReportCommands(program, deps);
  registerSizingCommands(program, deps);
  registerLoadCommands(program, deps);
  return program;
}

export interface RunResult {
  readonly code: number;
}

export async function run(argv: readonly string[], deps: CliDeps): Promise<RunResult> {
  const program = buildProgram(deps);
  try {
    await program.parseAsync([...argv], { from: 'user' });
    return { code: 0 };
  } catch (error) {
    const asCommander = error as { code?: string; exitCode?: number };
    if (asCommander.code === 'commander.helpDisplayed' || asCommander.code === 'commander.help') {
      return { code: 0 };
    }
    if (asCommander.code === 'commander.version') {
      return { code: 0 };
    }
    deps.writer.err(describeError(error));
    // A domain failure is the caller asking for something that cannot happen,
    // which is worth telling apart from this thing being broken.
    return { code: isDomainError(error) ? 2 : 1 };
  }
}

export function defaultDeps(writer: Writer = processWriter): CliDeps {
  let cached: Runtime | undefined;
  let settings: Settings | undefined;
  return {
    writer,
    settings: () => {
      settings ??= loadSettings();
      return settings;
    },
    runtime: () => {
      settings ??= loadSettings();
      cached ??= boot(settings);
      return cached;
    },
  };
}
