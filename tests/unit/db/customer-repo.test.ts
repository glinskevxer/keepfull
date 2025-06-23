import { afterEach, describe, expect, it } from 'vitest';
import { CustomerRepository } from '../../../src/db/repo/customer-repo';
import { aCustomer } from '../../support/fixtures';
import { closeTestDatabases, testDatabase } from '../../support/db';
import { dayKey } from '../../../src/util/dates';

afterEach(closeTestDatabases);

function repo(): CustomerRepository {
  return new CustomerRepository(testDatabase());
}

describe('insert and read back', () => {
  it('round trips every field', () => {
    const customers = repo();
    const customer = aCustomer({
      serviceName: 'Bell Hollow Barn',
      address: {
        line1: '4412 Bell Hollow Rd',
        line2: 'Barn 2',
        town: 'Danby',
        county: 'Tompkins',
        postalCode: '14883-0142',
        latitude: 42.3406,
        longitude: -76.4901,
      },
      holdReason: 'past due 90',
    });
    customers.insert(customer);
    expect(customers.get(customer.id)).toEqual(customer);
  });

  it('reports nothing for an id it does not hold', () => {
    expect(repo().find('c-nope')).toBeUndefined();
  });

  it('throws when the caller demands one', () => {
    expect(() => repo().get('c-nope')).toThrowError(/no customer with id c-nope/);
  });

  it('refuses a second account with the same number', () => {
    const customers = repo();
    const first = aCustomer();
    customers.insert(first);
    expect(() => customers.insert({ ...first, id: 'c-other' })).toThrowError(/already exists/);
  });

  it('finds one by its account number', () => {
    const customers = repo();
    const customer = aCustomer();
    customers.insert(customer);
    expect(customers.findByAccountNumber(customer.accountNumber)?.id).toBe(customer.id);
    expect(customers.findByAccountNumber('04-000000')).toBeUndefined();
  });
});

describe('update', () => {
  it('writes the changed fields', () => {
    const customers = repo();
    const customer = aCustomer();
    customers.insert(customer);
    customers.update({ ...customer, deliveryMode: 'will_call', billingName: 'Merrick Farms Inc' });
    const back = customers.get(customer.id);
    expect(back.deliveryMode).toBe('will_call');
    expect(back.billingName).toBe('Merrick Farms Inc');
  });

  it('clears an optional field that has been emptied', () => {
    const customers = repo();
    const customer = aCustomer({ holdReason: 'past due 90' });
    customers.insert(customer);
    const { holdReason: _dropped, ...without } = customer;
    customers.update(without);
    expect(customers.get(customer.id).holdReason).toBeUndefined();
  });

  it('refuses to update something that is not there', () => {
    expect(() => repo().update(aCustomer())).toThrowError(/no customer with id/);
  });
});

describe('list', () => {
  function seeded() {
    const customers = repo();
    customers.insert(aCustomer({ deliveryMode: 'keep_full', stationId: 'KITH' }));
    customers.insert(aCustomer({ deliveryMode: 'will_call', stationId: 'KITH' }));
    customers.insert(
      aCustomer({ deliveryMode: 'keep_full', stationId: 'KELM', rateClass: 'residential' }),
    );
    customers.insert(aCustomer({ deliveryMode: 'keep_full', closedOn: '2024-01-01' }));
    return customers;
  }

  it('returns everything in account order by default', () => {
    const customers = seeded();
    const all = customers.list();
    expect(all).toHaveLength(4);
    expect([...all].map((c) => c.accountNumber).sort()).toEqual(all.map((c) => c.accountNumber));
  });

  it('filters by delivery mode', () => {
    expect(seeded().list({ deliveryMode: 'will_call' })).toHaveLength(1);
  });

  it('filters by station', () => {
    expect(seeded().list({ stationId: 'KELM' })).toHaveLength(1);
  });

  it('filters by rate class', () => {
    expect(seeded().list({ rateClass: 'residential' })).toHaveLength(1);
  });

  it('filters by town', () => {
    expect(seeded().list({ town: 'Danby' })).toHaveLength(4);
    expect(seeded().list({ town: 'Newfield' })).toHaveLength(0);
  });

  it('can leave out the closed accounts', () => {
    expect(seeded().list({ openOnly: true })).toHaveLength(3);
  });

  it('combines filters', () => {
    expect(seeded().list({ deliveryMode: 'keep_full', openOnly: true })).toHaveLength(2);
  });

  it('pages', () => {
    const customers = seeded();
    const page = customers.list({ limit: 2, offset: 1 });
    expect(page).toHaveLength(2);
    expect(page[0]?.accountNumber).toBe(customers.list()[1]?.accountNumber);
  });

  it('counts without paging', () => {
    expect(seeded().count({ deliveryMode: 'keep_full' })).toBe(3);
  });
});

describe('holds', () => {
  it('sets and lifts', () => {
    const customers = repo();
    const customer = aCustomer();
    customers.insert(customer);
    customers.setHold(customer.id, 'gate locked');
    expect(customers.get(customer.id).holdReason).toBe('gate locked');
    customers.setHold(customer.id, undefined);
    expect(customers.get(customer.id).holdReason).toBeUndefined();
  });

  it('treats a blank reason as lifting the hold', () => {
    const customers = repo();
    const customer = aCustomer({ holdReason: 'gate locked' });
    customers.insert(customer);
    customers.setHold(customer.id, '   ');
    expect(customers.get(customer.id).holdReason).toBeUndefined();
  });

  it('refuses to hold an account that is not there', () => {
    expect(() => repo().setHold('c-nope', 'x')).toThrowError(/no customer with id/);
  });
});

describe('close and delete', () => {
  it('closes on a day', () => {
    const customers = repo();
    const customer = aCustomer();
    customers.insert(customer);
    customers.close(customer.id, dayKey('2025-06-30'));
    expect(customers.get(customer.id).closedOn).toBe('2025-06-30');
  });

  it('refuses to close before the account opened', () => {
    const customers = repo();
    const customer = aCustomer();
    customers.insert(customer);
    expect(() => customers.close(customer.id, dayKey('2018-01-01'))).toThrowError(
      /cannot close before it opened/,
    );
  });

  it('deletes and says whether there was anything to delete', () => {
    const customers = repo();
    const customer = aCustomer();
    customers.insert(customer);
    expect(customers.delete(customer.id)).toBe(true);
    expect(customers.delete(customer.id)).toBe(false);
  });
});
