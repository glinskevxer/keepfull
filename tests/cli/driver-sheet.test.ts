import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario, seedCleanHistory } from '../support/scenario';
import { cliDeps } from '../support/cli';
import { closeTestDatabases } from '../support/db';
import { makeContact } from '../../src/model/contact';
import { makeDriver, makeTruck } from '../../src/model/fleet';
import { run } from '../../src/cli/program';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2025-02-10' });
  scenario.context.fleet.saveTruck(
    makeTruck({ id: 'b-4', unitNumber: 'B-4', waterCapacity: 3000 }),
  );
  scenario.context.fleet.saveDriver(
    makeDriver({
      id: 'drv-3',
      name: 'R Vandemark',
      licenceNumber: 'NY-882-441',
      endorsements: ['hazmat', 'tanker'],
    }),
  );
  seedCleanHistory(scenario);
  return { scenario, ...cliDeps(scenario) };
}

async function sheetFor(context: ReturnType<typeof setup>) {
  await run(['dispatch', 'commit', '--window', '30'], context.deps);
  const routeId = context.scenario.context.routes.list()[0]?.id as string;
  context.writer.stdout.length = 0;
  await run(['dispatch', 'sheet', routeId], context.deps);
  return context.writer.text;
}

describe('the driver sheet', () => {
  it('carries a ring column even when nobody is on file', async () => {
    const context = setup();
    const sheet = await sheetFor(context);
    expect(sheet).toMatch(/#\s+account\s+address\s+tank\s+gallons\s+outcome\s+ring\s+notes/);
  });

  it('names the site contact rather than the billing one', async () => {
    const context = setup();
    context.scenario.context.contacts.assign(
      makeContact({
        id: 'ct-b',
        customerId: context.scenario.customer.id,
        name: 'Accounts Payable',
        role: 'billing',
        phone: '212-555-0100',
      }),
    );
    context.scenario.context.contacts.assign(
      makeContact({
        id: 'ct-s',
        customerId: context.scenario.customer.id,
        name: 'R Merrick',
        role: 'site',
        phone: '607-555-0142',
      }),
    );
    const sheet = await sheetFor(context);
    expect(sheet).toMatch(/R Merrick \(site\) \(607\) 555-0142/);
    expect(sheet).not.toMatch(/Accounts Payable/);
  });

  it('falls back to billing when there is no site contact', async () => {
    const context = setup();
    context.scenario.context.contacts.assign(
      makeContact({
        id: 'ct-b',
        customerId: context.scenario.customer.id,
        name: 'Accounts Payable',
        role: 'billing',
        phone: '212-555-0100',
      }),
    );
    expect(await sheetFor(context)).toMatch(/Accounts Payable \(billing\)/);
  });

  it('leaves a retired contact off', async () => {
    const context = setup();
    context.scenario.context.contacts.assign(
      makeContact({
        id: 'ct-s',
        customerId: context.scenario.customer.id,
        name: 'R Merrick',
        role: 'site',
        phone: '607-555-0142',
      }),
    );
    context.scenario.context.contacts.retire('ct-s');
    expect(await sheetFor(context)).not.toMatch(/R Merrick/);
  });

  it('carries the tank notes across to the driver', async () => {
    const context = setup();
    context.scenario.context.tanks.update({
      ...context.scenario.context.tanks.get(context.scenario.tank.id),
      notes: 'gate code 4412',
    });
    expect(await sheetFor(context)).toMatch(/gate code 4412/);
  });
});
