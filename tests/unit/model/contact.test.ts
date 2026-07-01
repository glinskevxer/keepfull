import { describe, expect, it } from 'vitest';
import {
  Contact,
  ContactDraft,
  checkEmail,
  describeContact,
  formatPhone,
  makeContact,
  normalisePhone,
  siteContact,
} from '../../../src/model/contact';

const draft: ContactDraft = {
  id: 'ct-1',
  customerId: 'cus-1',
  name: 'R Merrick',
  role: 'site',
  phone: '607-555-0142',
};

function contact(overrides: Partial<ContactDraft> = {}): Contact {
  return makeContact({ ...draft, ...overrides });
}

describe('normalisePhone', () => {
  it('takes the punctuation off', () => {
    expect(normalisePhone('607-555-0142')).toBe('6075550142');
    expect(normalisePhone('(607) 555 0142')).toBe('6075550142');
    expect(normalisePhone('607.555.0142')).toBe('6075550142');
  });

  it('drops a leading country code', () => {
    expect(normalisePhone('1 607 555 0142')).toBe('6075550142');
  });

  it('refuses something that is not a phone number', () => {
    expect(() => normalisePhone('555-0142')).toThrowError(/ten digit/);
    expect(() => normalisePhone('call the barn')).toThrowError(/ten digit/);
  });

  it('formats one back the way the office writes it', () => {
    expect(formatPhone('6075550142')).toBe('(607) 555-0142');
  });
});

describe('checkEmail', () => {
  it('accepts an ordinary address and lowercases it', () => {
    expect(checkEmail(' Roy@Merrick-Farms.COM ')).toBe('roy@merrick-farms.com');
  });

  it('refuses something that is not one', () => {
    for (const value of ['nope', 'a@b', 'a b@c.com', '@c.com']) {
      expect(() => checkEmail(value)).toThrowError(/not an email address/);
    }
  });
});

describe('makeContact', () => {
  it('normalises the phone number on the way in', () => {
    expect(contact({ phone: '(607) 555-0142' }).phone).toBe('6075550142');
  });

  it('takes an email only contact', () => {
    const built = makeContact({
      id: 'ct-2',
      customerId: 'cus-1',
      name: 'Accounts',
      role: 'billing',
      email: 'ap@merrick.com',
    });
    expect(built.phone).toBeUndefined();
    expect(built.email).toBe('ap@merrick.com');
  });

  it('refuses a contact with no way to reach them', () => {
    expect(() =>
      makeContact({ id: 'ct-3', customerId: 'cus-1', name: 'Nobody', role: 'other' }),
    ).toThrowError(/phone number or an email/);
  });

  it('refuses a role it does not know', () => {
    expect(() => contact({ role: 'gate' as never })).toThrowError(/not a contact role/);
  });

  it('refuses a blank name', () => {
    expect(() => contact({ name: ' ' })).toThrowError(/contact name/);
  });

  it('is active unless told otherwise', () => {
    expect(contact().active).toBe(true);
    expect(contact({ active: false }).active).toBe(false);
  });
});

describe('siteContact', () => {
  const site = contact({ id: 'a', role: 'site' });
  const emergency = contact({ id: 'b', role: 'emergency' });
  const billing = contact({ id: 'c', role: 'billing' });

  it('prefers the site contact', () => {
    expect(siteContact([billing, emergency, site])?.id).toBe('a');
  });

  it('falls back to emergency then billing', () => {
    expect(siteContact([billing, emergency])?.id).toBe('b');
    expect(siteContact([billing])?.id).toBe('c');
  });

  it('ignores an inactive contact', () => {
    expect(siteContact([{ ...site, active: false }, billing])?.id).toBe('c');
  });

  it('has nobody to suggest from an empty list', () => {
    expect(siteContact([])).toBeUndefined();
  });
});

describe('describeContact', () => {
  it('reads the way the office would say it', () => {
    expect(describeContact(contact())).toBe('R Merrick (site) (607) 555-0142');
  });

  it('carries both when both are on file', () => {
    expect(describeContact(contact({ email: 'r@merrick.com' }))).toBe(
      'R Merrick (site) (607) 555-0142, r@merrick.com',
    );
  });
});
