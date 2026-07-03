import { afterEach, describe, expect, it } from 'vitest';
import { buildScenario } from '../support/scenario';
import { call, closeTestServers, testServer } from '../support/api';
import { closeTestDatabases } from '../support/db';

afterEach(async () => {
  await closeTestServers();
  closeTestDatabases();
});

function setup() {
  const scenario = buildScenario({ today: '2026-07-02' });
  return { scenario, app: testServer(scenario.context) };
}

const contact = { name: 'R Merrick', role: 'site', phone: '607-555-0142' };

describe('contacts', () => {
  it('creates one against an account', async () => {
    const { scenario, app } = setup();
    const response = await call<{ contact: { id: string; phone: string } }>(
      app,
      'POST',
      `/customers/${scenario.customer.id}/contacts`,
      contact,
    );
    expect(response.status).toBe(201);
    expect(response.body.contact.phone).toBe('6075550142');
  });

  it('refuses a contact with no way to reach them', async () => {
    const { scenario, app } = setup();
    const response = await call(app, 'POST', `/customers/${scenario.customer.id}/contacts`, {
      name: 'Nobody',
      role: 'other',
    });
    expect(response.status).toBe(400);
  });

  it('refuses a phone number that is not one', async () => {
    const { scenario, app } = setup();
    const response = await call(app, 'POST', `/customers/${scenario.customer.id}/contacts`, {
      ...contact,
      phone: '555-0142',
    });
    expect(response.status).toBe(400);
  });

  it('refuses an account we do not have', async () => {
    const { app } = setup();
    expect((await call(app, 'POST', '/customers/c-nope/contacts', contact)).status).toBe(404);
  });

  it('lists the live ones', async () => {
    const { scenario, app } = setup();
    await call(app, 'POST', `/customers/${scenario.customer.id}/contacts`, contact);
    await call(app, 'POST', `/customers/${scenario.customer.id}/contacts`, {
      name: 'Accounts',
      role: 'billing',
      email: 'ap@merrick.com',
    });
    const response = await call<{ contacts: { role: string }[] }>(
      app,
      'GET',
      `/customers/${scenario.customer.id}/contacts`,
    );
    expect(response.body.contacts.map((entry) => entry.role).sort()).toEqual(['billing', 'site']);
  });

  it('replaces the person holding a role', async () => {
    const { scenario, app } = setup();
    await call(app, 'POST', `/customers/${scenario.customer.id}/contacts`, contact);
    await call(app, 'POST', `/customers/${scenario.customer.id}/contacts`, {
      ...contact,
      name: 'A Merrick',
    });
    const response = await call<{ contacts: { name: string }[] }>(
      app,
      'GET',
      `/customers/${scenario.customer.id}/contacts`,
    );
    expect(response.body.contacts.map((entry) => entry.name)).toEqual(['A Merrick']);
  });

  it('retires one', async () => {
    const { scenario, app } = setup();
    const created = await call<{ contact: { id: string } }>(
      app,
      'POST',
      `/customers/${scenario.customer.id}/contacts`,
      contact,
    );
    const response = await call<{ contact: { active: boolean } }>(
      app,
      'POST',
      `/customers/${scenario.customer.id}/contacts/${created.body.contact.id}/retire`,
      {},
    );
    expect(response.body.contact.active).toBe(false);
    const listed = await call<{ contacts: unknown[] }>(
      app,
      'GET',
      `/customers/${scenario.customer.id}/contacts`,
    );
    expect(listed.body.contacts).toEqual([]);
  });
});
