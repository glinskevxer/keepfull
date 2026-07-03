import { afterEach, describe, expect, it } from 'vitest';
import { ContactRepository } from '../../../src/db/repo/contact-repo';
import { CustomerRepository } from '../../../src/db/repo/customer-repo';
import { aCustomer } from '../../support/fixtures';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { makeContact } from '../../../src/model/contact';

afterEach(closeTestDatabases);

function setup() {
  const db = testDatabase();
  const customer = aCustomer();
  new CustomerRepository(db).insert(customer);
  return { contacts: new ContactRepository(db), customer, db };
}

function aContact(customerId: string, overrides: Record<string, unknown> = {}) {
  return makeContact({
    id: 'ct-1',
    customerId,
    name: 'R Merrick',
    role: 'site',
    phone: '607-555-0142',
    ...overrides,
  } as never);
}

describe('assign', () => {
  it('round trips', () => {
    const { contacts, customer } = setup();
    const contact = aContact(customer.id);
    expect(contacts.assign(contact)).toEqual(contact);
  });

  it('retires whoever held the role before', () => {
    const { contacts, customer } = setup();
    contacts.assign(aContact(customer.id));
    contacts.assign(aContact(customer.id, { id: 'ct-2', name: 'A Merrick' }));
    expect(contacts.get('ct-1').active).toBe(false);
    expect(contacts.forCustomer(customer.id).map((entry) => entry.id)).toEqual(['ct-2']);
  });

  it('leaves the other roles alone', () => {
    const { contacts, customer } = setup();
    contacts.assign(aContact(customer.id, { role: 'billing', id: 'ct-b' }));
    contacts.assign(aContact(customer.id, { role: 'site', id: 'ct-s' }));
    expect(contacts.forCustomer(customer.id)).toHaveLength(2);
  });

  it('updates a contact in place rather than retiring it against itself', () => {
    const { contacts, customer } = setup();
    contacts.assign(aContact(customer.id));
    const updated = contacts.assign(aContact(customer.id, { name: 'R Merrick Jr' }));
    expect(updated.name).toBe('R Merrick Jr');
    expect(updated.active).toBe(true);
  });

  it('lets an inactive contact be stored without retiring the live one', () => {
    const { contacts, customer } = setup();
    contacts.assign(aContact(customer.id));
    contacts.assign(aContact(customer.id, { id: 'ct-2', active: false }));
    expect(contacts.get('ct-1').active).toBe(true);
  });

  it('refuses a contact against an account that is not there', () => {
    const { contacts } = setup();
    expect(() => contacts.assign(aContact('cus-nope'))).toThrowError();
  });

  it('throws for one it does not hold', () => {
    expect(() => setup().contacts.get('ct-9')).toThrowError(/no contact with id/);
  });
});

describe('list', () => {
  it('filters by customer, role and whether they are live', () => {
    const { contacts, customer } = setup();
    contacts.assign(aContact(customer.id, { role: 'billing', id: 'ct-b' }));
    contacts.assign(aContact(customer.id, { role: 'site', id: 'ct-s' }));
    contacts.retire('ct-s');
    expect(contacts.list({ customerId: customer.id })).toHaveLength(2);
    expect(contacts.list({ role: 'billing' })).toHaveLength(1);
    expect(contacts.list({ activeOnly: true })).toHaveLength(1);
  });
});

describe('retire and delete', () => {
  it('retires one and frees the role', () => {
    const { contacts, customer } = setup();
    contacts.assign(aContact(customer.id));
    expect(contacts.retire('ct-1').active).toBe(false);
    expect(() => contacts.assign(aContact(customer.id, { id: 'ct-2' }))).not.toThrow();
  });

  it('refuses to retire one that is not there', () => {
    expect(() => setup().contacts.retire('ct-9')).toThrowError(/no contact with id/);
  });

  it('deletes, and says whether there was anything to delete', () => {
    const { contacts, customer } = setup();
    contacts.assign(aContact(customer.id));
    expect(contacts.delete('ct-1')).toBe(true);
    expect(contacts.delete('ct-1')).toBe(false);
  });

  it('goes with the account', () => {
    const { contacts, customer, db } = setup();
    contacts.assign(aContact(customer.id));
    new CustomerRepository(db).delete(customer.id);
    expect(contacts.find('ct-1')).toBeUndefined();
  });
});
