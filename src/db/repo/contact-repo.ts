import { Contact, ContactRole, makeContact } from '../../model/contact';
import { ConflictError, NotFoundError } from '../../core/errors';
import { Db, inTransaction } from '../connection';
import { WhereClause } from '../query';

interface ContactRow {
  id: string;
  customer_id: string;
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: number;
}

function toContact(row: ContactRow): Contact {
  return makeContact({
    id: row.id,
    customerId: row.customer_id,
    name: row.name,
    role: row.role as ContactRole,
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.email ? { email: row.email } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
    active: row.active === 1,
  });
}

/**
 * The unique index allows one active contact per role, so putting a new one in
 * has to retire the old one. Doing that in two statements outside a transaction
 * is how an account ends up with no site contact at all, which is worse than
 * having a stale one.
 */
export class ContactRepository {
  constructor(private readonly db: Db) {}

  /** Puts a contact in, retiring whoever currently holds that role. */
  assign(contact: Contact): Contact {
    return inTransaction(this.db, () => {
      if (contact.active) {
        this.db
          .prepare(
            'UPDATE contacts SET active = 0 WHERE customer_id = ? AND role = ? AND active = 1 AND id <> ?',
          )
          .run(contact.customerId, contact.role, contact.id);
      }
      try {
        this.db
          .prepare(
            `INSERT INTO contacts (id, customer_id, name, role, phone, email, notes, active)
             VALUES (@id, @customerId, @name, @role, @phone, @email, @notes, @active)
             ON CONFLICT (id) DO UPDATE SET
               name = excluded.name,
               role = excluded.role,
               phone = excluded.phone,
               email = excluded.email,
               notes = excluded.notes,
               active = excluded.active`,
          )
          .run({
            id: contact.id,
            customerId: contact.customerId,
            name: contact.name,
            role: contact.role,
            phone: contact.phone ?? null,
            email: contact.email ?? null,
            notes: contact.notes ?? null,
            active: contact.active ? 1 : 0,
          });
      } catch (error) {
        if (String(error).includes('UNIQUE')) {
          throw new ConflictError(`that account already has an active ${contact.role} contact`, {
            customerId: contact.customerId,
            role: contact.role,
          });
        }
        throw error;
      }
      return this.get(contact.id);
    });
  }

  find(id: string): Contact | undefined {
    const row = this.db
      .prepare<[string], ContactRow>('SELECT * FROM contacts WHERE id = ?')
      .get(id);
    return row ? toContact(row) : undefined;
  }

  get(id: string): Contact {
    const contact = this.find(id);
    if (!contact) {
      throw new NotFoundError('contact', id);
    }
    return contact;
  }

  list(query: { customerId?: string; role?: ContactRole; activeOnly?: boolean } = {}): Contact[] {
    const where = new WhereClause()
      .eq('customer_id', 'customerId', query.customerId)
      .eq('role', 'role', query.role)
      .when(query.activeOnly, 'active = 1');
    return this.db
      .prepare<
        Record<string, unknown>,
        ContactRow
      >(`SELECT * FROM contacts ${where.sql} ORDER BY customer_id, role, name`)
      .all(where.bind())
      .map(toContact);
  }

  forCustomer(customerId: string): Contact[] {
    return this.list({ customerId, activeOnly: true });
  }

  retire(id: string): Contact {
    const result = this.db.prepare('UPDATE contacts SET active = 0 WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new NotFoundError('contact', id);
    }
    return this.get(id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM contacts WHERE id = ?').run(id).changes > 0;
  }
}
