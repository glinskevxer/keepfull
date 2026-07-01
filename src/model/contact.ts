import { InvalidInputError } from '../core/errors';
import { assertNonEmpty } from '../util/assert';

/**
 * Somebody to ring about an account.
 *
 * There is at most one active contact per role, which is a deliberate
 * restriction rather than a modelling accident. The question a driver asks is
 * "who do I ring about the gate", and an answer that is a list of three people
 * is the same as no answer at all.
 */

export type ContactRole = 'billing' | 'site' | 'emergency' | 'other';

export const CONTACT_ROLES: readonly ContactRole[] = ['billing', 'site', 'emergency', 'other'];

export interface Contact {
  readonly id: string;
  readonly customerId: string;
  readonly name: string;
  readonly role: ContactRole;
  readonly phone?: string;
  readonly email?: string;
  readonly notes?: string;
  readonly active: boolean;
}

export interface ContactDraft {
  readonly id: string;
  readonly customerId: string;
  readonly name: string;
  readonly role: ContactRole;
  readonly phone?: string;
  readonly email?: string;
  readonly notes?: string;
  readonly active?: boolean;
}

/**
 * Ten digits, however they were typed. Numbers arrive from three places and
 * every one of them punctuates differently, so they are normalised on the way
 * in and formatted on the way out.
 */
export function normalisePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length !== 10) {
    throw new InvalidInputError(`"${value}" is not a ten digit phone number`, { value });
  }
  return national;
}

export function formatPhone(value: string): string {
  const digits = normalisePhone(value);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const EMAIL = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

export function checkEmail(value: string): string {
  const trimmed = value.trim();
  if (!EMAIL.test(trimmed)) {
    throw new InvalidInputError(`"${value}" is not an email address`, { value });
  }
  return trimmed.toLowerCase();
}

export function makeContact(draft: ContactDraft): Contact {
  assertNonEmpty(draft.id, 'contact id');
  assertNonEmpty(draft.customerId, 'customer id');
  assertNonEmpty(draft.name, 'contact name');
  if (!CONTACT_ROLES.includes(draft.role)) {
    throw new InvalidInputError(`"${draft.role}" is not a contact role`);
  }
  const phone = draft.phone === undefined ? undefined : normalisePhone(draft.phone);
  const email = draft.email === undefined ? undefined : checkEmail(draft.email);
  if (phone === undefined && email === undefined) {
    throw new InvalidInputError('a contact needs a phone number or an email address', {
      name: draft.name,
    });
  }
  return {
    id: draft.id,
    customerId: draft.customerId,
    name: draft.name,
    role: draft.role,
    ...(phone === undefined ? {} : { phone }),
    ...(email === undefined ? {} : { email }),
    ...(draft.notes ? { notes: draft.notes } : {}),
    active: draft.active ?? true,
  };
}

/** Who a driver rings about a gate, falling back the way the office would. */
export function siteContact(contacts: readonly Contact[]): Contact | undefined {
  const live = contacts.filter((contact) => contact.active);
  return (
    live.find((contact) => contact.role === 'site') ??
    live.find((contact) => contact.role === 'emergency') ??
    live.find((contact) => contact.role === 'billing')
  );
}

export function describeContact(contact: Contact): string {
  const reach = [contact.phone ? formatPhone(contact.phone) : undefined, contact.email].filter(
    (entry): entry is string => entry !== undefined,
  );
  return `${contact.name} (${contact.role}) ${reach.join(', ')}`;
}
