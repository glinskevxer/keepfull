import { AppContext } from '../../service/context';
import {
  Customer,
  DeliveryMode,
  RateClass,
  ServiceAddress,
  makeCustomer,
} from '../../model/customer';
import { FastifyInstance } from 'fastify';
import { createCustomerSchema, customerQuerySchema, updateCustomerSchema } from '../schema';
import { dayKey } from '../../util/dates';
import { parseOrThrow } from '../validate';
import { makeContact } from '../../model/contact';
import { requireRole } from '../auth';

/**
 * Accounts. The office screens do almost all of their reading through the list
 * endpoint, so it carries every filter the search box offers rather than making
 * the screen fetch everything and sift.
 */

function present(customer: Customer): Record<string, unknown> {
  return {
    id: customer.id,
    accountNumber: customer.accountNumber,
    billingName: customer.billingName,
    serviceName: customer.serviceName,
    address: customer.address,
    deliveryMode: customer.deliveryMode,
    rateClass: customer.rateClass,
    stationId: customer.stationId,
    openedOn: customer.openedOn,
    closedOn: customer.closedOn ?? null,
    holdReason: customer.holdReason ?? null,
  };
}

/** Zod leaves an absent optional as `undefined`, which the domain type refuses. */
function toAddress(input: {
  line1: string;
  line2?: string | undefined;
  town: string;
  county: string;
  postalCode: string;
  latitude: number;
  longitude: number;
}): ServiceAddress {
  return {
    line1: input.line1,
    ...(input.line2 ? { line2: input.line2 } : {}),
    town: input.town,
    county: input.county,
    postalCode: input.postalCode,
    latitude: input.latitude,
    longitude: input.longitude,
  };
}

export function registerCustomerRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/customers', { preHandler: requireRole('office', 'job') }, async (request) => {
    const query = parseOrThrow(customerQuerySchema, request.query);
    const customers = context.customers.list({
      ...(query.deliveryMode ? { deliveryMode: query.deliveryMode as DeliveryMode } : {}),
      ...(query.rateClass ? { rateClass: query.rateClass as RateClass } : {}),
      ...(query.stationId ? { stationId: query.stationId } : {}),
      ...(query.town ? { town: query.town } : {}),
      ...(query.openOnly ? { openOnly: true } : {}),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.offset === undefined ? {} : { offset: query.offset }),
    });
    return {
      customers: customers.map(present),
      total: context.customers.count({
        ...(query.deliveryMode ? { deliveryMode: query.deliveryMode as DeliveryMode } : {}),
        ...(query.openOnly ? { openOnly: true } : {}),
      }),
    };
  });

  app.get<{ Params: { id: string } }>(
    '/customers/:id',
    { preHandler: requireRole('office', 'driver', 'job') },
    async (request) => {
      const customer = context.customers.get(request.params.id);
      const tanks = context.tanks.list({ customerId: customer.id });
      return {
        customer: present(customer),
        tanks: tanks.map((tank) => ({
          id: tank.id,
          serialNumber: tank.serialNumber,
          waterCapacity: tank.waterCapacity,
          fillLimit: tank.geometry.fillLimit,
          reservePercent: tank.geometry.reservePercent,
          inService: tank.removedOn === undefined,
        })),
      };
    },
  );

  app.post('/customers', { preHandler: requireRole('office') }, async (request, reply) => {
    const body = parseOrThrow(createCustomerSchema, request.body);
    const customer = makeCustomer({
      id: context.ids.next('cus'),
      accountNumber: body.accountNumber,
      billingName: body.billingName,
      ...(body.serviceName ? { serviceName: body.serviceName } : {}),
      address: toAddress(body.address),
      deliveryMode: body.deliveryMode as DeliveryMode,
      rateClass: body.rateClass as RateClass,
      stationId: body.stationId,
      openedOn: body.openedOn,
    });
    context.weather.getStation(customer.stationId);
    context.customers.insert(customer);
    reply.code(201);
    return { customer: present(customer) };
  });

  app.patch<{ Params: { id: string } }>(
    '/customers/:id',
    { preHandler: requireRole('office') },
    async (request) => {
      const body = parseOrThrow(updateCustomerSchema, request.body);
      const existing = context.customers.get(request.params.id);
      const merged = makeCustomer({
        id: existing.id,
        accountNumber: body.accountNumber ?? existing.accountNumber,
        billingName: body.billingName ?? existing.billingName,
        serviceName: body.serviceName ?? existing.serviceName,
        address: body.address ? toAddress(body.address) : existing.address,
        deliveryMode: (body.deliveryMode as DeliveryMode) ?? existing.deliveryMode,
        rateClass: (body.rateClass as RateClass) ?? existing.rateClass,
        stationId: body.stationId ?? existing.stationId,
        openedOn: body.openedOn ?? existing.openedOn,
        ...(existing.closedOn ? { closedOn: existing.closedOn } : {}),
        ...(body.holdReason === undefined
          ? existing.holdReason
            ? { holdReason: existing.holdReason }
            : {}
          : body.holdReason === null
            ? {}
            : { holdReason: body.holdReason }),
      });
      context.customers.update(merged);
      return { customer: present(merged) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/customers/:id/contacts',
    { preHandler: requireRole('office', 'driver', 'job') },
    async (request) => {
      context.customers.get(request.params.id);
      return { contacts: context.contacts.forCustomer(request.params.id) };
    },
  );

  app.post<{
    Params: { id: string };
    Body: { name: string; role: string; phone?: string; email?: string; notes?: string };
  }>('/customers/:id/contacts', { preHandler: requireRole('office') }, async (request, reply) => {
    context.customers.get(request.params.id);
    const contact = makeContact({
      id: context.ids.next('ct'),
      customerId: request.params.id,
      name: request.body.name,
      role: request.body.role as never,
      ...(request.body.phone ? { phone: request.body.phone } : {}),
      ...(request.body.email ? { email: request.body.email } : {}),
      ...(request.body.notes ? { notes: request.body.notes } : {}),
    });
    reply.code(201);
    return { contact: context.contacts.assign(contact) };
  });

  app.post<{ Params: { id: string; contactId: string } }>(
    '/customers/:id/contacts/:contactId/retire',
    { preHandler: requireRole('office') },
    async (request) => ({ contact: context.contacts.retire(request.params.contactId) }),
  );

  app.post<{ Params: { id: string }; Body: { on?: string } }>(
    '/customers/:id/close',
    { preHandler: requireRole('office') },
    async (request) => {
      const on = request.body?.on;
      context.customers.close(
        request.params.id,
        on ? dayKey(on) : dayKey(new Date().toISOString().slice(0, 10)),
      );
      return { customer: present(context.customers.get(request.params.id)) };
    },
  );
}
