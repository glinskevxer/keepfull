import { AppContext, currentDay } from '../../service/context';
import {
  Driver,
  LicenceEndorsement,
  Truck,
  TruckKind,
  canHaulPropane,
  makeDriver,
  makeTruck,
  meterSealExpiresOn,
  workingCapacity,
} from '../../model/fleet';
import { FastifyInstance } from 'fastify';
import { dayKey } from '../../util/dates';
import { requireRole } from '../auth';

/**
 * Trucks and drivers.
 *
 * Both presentations carry the derived answer rather than the raw dates,
 * because every screen that shows a truck wants to know whether it can go out
 * today, and every screen that shows a driver wants to know whether they can
 * take it. Making four different screens work that out from a sealing date is
 * how three of them end up disagreeing.
 */

function presentTruck(truck: Truck, on: string): Record<string, unknown> {
  const expires = meterSealExpiresOn(truck);
  return {
    id: truck.id,
    unitNumber: truck.unitNumber,
    kind: truck.kind,
    waterCapacity: truck.waterCapacity,
    fillLimit: truck.fillLimit,
    heelGallons: truck.heelGallons,
    workingCapacity: workingCapacity(truck),
    meterSealedOn: truck.meterSealedOn ?? null,
    meterSealExpiresOn: expires ?? null,
    canWriteTickets: expires !== undefined && on <= expires,
    active: truck.active,
  };
}

function presentDriver(driver: Driver, on: string): Record<string, unknown> {
  return {
    id: driver.id,
    name: driver.name,
    licenceNumber: driver.licenceNumber,
    endorsements: driver.endorsements,
    medicalCardExpiresOn: driver.medicalCardExpiresOn ?? null,
    canHaul: canHaulPropane(driver, dayKey(on)),
    active: driver.active,
  };
}

export function registerFleetRoutes(app: FastifyInstance, context: AppContext): void {
  app.get<{ Querystring: { activeOnly?: string; kind?: string } }>(
    '/trucks',
    { preHandler: requireRole('office', 'driver', 'job') },
    async (request) => {
      const on = currentDay(context);
      return {
        trucks: context.fleet
          .listTrucks({
            ...(request.query.activeOnly === 'true' ? { activeOnly: true } : {}),
            ...(request.query.kind ? { kind: request.query.kind as TruckKind } : {}),
          })
          .map((truck) => presentTruck(truck, on)),
      };
    },
  );

  app.post<{
    Body: {
      unitNumber: string;
      kind?: TruckKind;
      waterCapacity: number;
      fillLimit?: number;
      heelGallons?: number;
      meterSealedOn?: string;
    };
  }>('/trucks', { preHandler: requireRole('office') }, async (request, reply) => {
    const truck = makeTruck({ id: context.ids.next('trk'), ...request.body });
    context.fleet.saveTruck(truck);
    reply.code(201);
    return { truck: presentTruck(truck, currentDay(context)) };
  });

  app.get<{ Params: { id: string } }>(
    '/trucks/:id',
    { preHandler: requireRole('office', 'driver', 'job') },
    async (request) => ({
      truck: presentTruck(context.fleet.getTruck(request.params.id), currentDay(context)),
    }),
  );

  app.post<{ Params: { id: string }; Body: { on?: string } }>(
    '/trucks/:id/meter-seal',
    { preHandler: requireRole('office') },
    async (request) => {
      const on = request.body?.on ? dayKey(request.body.on) : currentDay(context);
      context.fleet.recordMeterSeal(request.params.id, on);
      return {
        truck: presentTruck(context.fleet.getTruck(request.params.id), currentDay(context)),
      };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/trucks/:id/retire',
    { preHandler: requireRole('office') },
    async (request) => {
      context.fleet.retireTruck(request.params.id);
      return {
        truck: presentTruck(context.fleet.getTruck(request.params.id), currentDay(context)),
      };
    },
  );

  app.get<{ Querystring: { activeOnly?: string } }>(
    '/drivers',
    { preHandler: requireRole('office', 'job') },
    async (request) => {
      const on = currentDay(context);
      return {
        drivers: context.fleet
          .listDrivers(request.query.activeOnly === 'true' ? { activeOnly: true } : {})
          .map((driver) => presentDriver(driver, on)),
      };
    },
  );

  app.post<{
    Body: {
      name: string;
      licenceNumber: string;
      endorsements?: LicenceEndorsement[];
      medicalCardExpiresOn?: string;
    };
  }>('/drivers', { preHandler: requireRole('office') }, async (request, reply) => {
    const driver = makeDriver({ id: context.ids.next('drv'), ...request.body });
    context.fleet.saveDriver(driver);
    reply.code(201);
    return { driver: presentDriver(driver, currentDay(context)) };
  });

  app.get<{ Params: { id: string } }>(
    '/drivers/:id',
    { preHandler: requireRole('office', 'job') },
    async (request) => ({
      driver: presentDriver(context.fleet.getDriver(request.params.id), currentDay(context)),
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/drivers/:id/retire',
    { preHandler: requireRole('office') },
    async (request) => {
      context.fleet.retireDriver(request.params.id);
      return {
        driver: presentDriver(context.fleet.getDriver(request.params.id), currentDay(context)),
      };
    },
  );
}
