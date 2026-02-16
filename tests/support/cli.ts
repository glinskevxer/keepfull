import { CliDeps } from '../../src/cli/program';
import { MemoryWriter } from '../../src/cli/output';
import { Runtime } from '../../src/bootstrap';
import { Scenario } from './scenario';
import { loadSettings } from '../../src/config/env';

/** Wires the cli to a scenario's in memory database instead of a real file. */
export function cliDeps(scenario: Scenario): { deps: CliDeps; writer: MemoryWriter } {
  const writer = new MemoryWriter();
  const runtime: Runtime = {
    context: scenario.context,
    db: scenario.context.db,
    logger: scenario.context.logger,
    shutdown() {
      /* the scenario owns the database */
    },
  };
  const settings = loadSettings({
    YARD_LATITUDE: '42.4432',
    YARD_LONGITUDE: '-76.5019',
    LOG_LEVEL: 'error',
  } as NodeJS.ProcessEnv);
  return {
    writer,
    deps: { writer, runtime: () => runtime, settings: () => settings },
  };
}
