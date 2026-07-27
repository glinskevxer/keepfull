import { afterEach, describe, expect, it } from 'vitest';
import { CustomerRepository } from '../../../src/db/repo/customer-repo';
import { TankRepository } from '../../../src/db/repo/tank-repo';
import { aCustomer, aTank } from '../../support/fixtures';
import { closeTestDatabases, testDatabase } from '../../support/db';

afterEach(closeTestDatabases);

function setup() {
  const db = testDatabase();
  const customers = new CustomerRepository(db);
  const tanks = new TankRepository(db);
  const merrick = aCustomer({
    accountNumber: '04-118372',
    billingName: 'Merrick Farms LLC',
    serviceName: 'Bell Hollow Barn',
  });
  const hollis = aCustomer({
    accountNumber: '04-220145',
    billingName: 'Hollis Property',
    address: {
      line1: '88 Coddington Rd',
      town: 'Newfield',
      county: 'Tompkins',
      postalCode: '14867',
      latitude: 42.3595,
      longitude: -76.5949,
    },
  });
  customers.insert(merrick);
  customers.insert(hollis);
  tanks.insert(aTank(merrick.id, { serialNumber: 'TR-991044' }));
  return { customers, merrick, hollis };
}

describe('search', () => {
  it('finds an account by part of the name', () => {
    const { customers, merrick } = setup();
    const hits = customers.search('merrick');
    expect(hits.map((hit) => hit.customer.id)).toEqual([merrick.id]);
    expect(hits[0]?.matchedOn).toBe('name');
  });

  it('finds one by the service name as well as the billing name', () => {
    const { customers, merrick } = setup();
    expect(customers.search('bell hollow')[0]?.customer.id).toBe(merrick.id);
  });

  it('finds one by account number with or without the dash', () => {
    const { customers, merrick } = setup();
    expect(customers.search('04-118372')[0]?.customer.id).toBe(merrick.id);
    expect(customers.search('04118372')[0]?.customer.id).toBe(merrick.id);
    expect(customers.search('04-118372')[0]?.matchedOn).toBe('account');
  });

  it('finds one by road or town', () => {
    const { customers, hollis } = setup();
    expect(customers.search('Coddington')[0]?.customer.id).toBe(hollis.id);
    expect(customers.search('Newfield')[0]?.matchedOn).toBe('address');
  });

  it('finds one by the serial off the tank in front of you', () => {
    const { customers, merrick } = setup();
    const hits = customers.search('991044');
    expect(hits[0]?.customer.id).toBe(merrick.id);
    expect(hits[0]?.matchedOn).toBe('tank');
  });

  it('puts an account number match first', () => {
    const { customers } = setup();
    const hits = customers.search('04');
    expect(hits[0]?.matchedOn).toBe('account');
  });

  it('is case insensitive', () => {
    const { customers } = setup();
    expect(customers.search('MERRICK')).toHaveLength(1);
  });

  it('refuses to search on one character', () => {
    const { customers } = setup();
    expect(customers.search('m')).toEqual([]);
    expect(customers.search(' ')).toEqual([]);
  });

  it('treats a wildcard as a literal rather than a search of everything', () => {
    const { customers } = setup();
    expect(customers.search('%%')).toEqual([]);
  });

  it('caps the results', () => {
    const { customers } = setup();
    expect(customers.search('04', 1)).toHaveLength(1);
  });

  it('finds nothing for a term nobody matches', () => {
    expect(setup().customers.search('zzzz')).toEqual([]);
  });
});
