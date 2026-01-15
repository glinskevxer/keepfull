import { z } from 'zod';
import { DELIVERY_MODES, RATE_CLASSES } from '../model/customer';
import { APPLIANCES, TANK_SETTINGS } from '../model/tank';
import { FILL_REASONS } from '../model/delivery';
import { READING_SOURCES } from '../model/reading';
import { STOCK_CAPACITIES } from '../core/tank-math';
import { isDayKey } from '../util/dates';

/**
 * Request shapes for the http layer, and only for the http layer.
 *
 * The domain constructors already refuse nonsense, and they stay that way,
 * because they are also what the importers and the cli go through. What these
 * add is the part a constructor cannot do: telling a caller which field was
 * wrong before anything is touched, in a shape a browser can render.
 */

export const dayString: z.ZodString | z.ZodEffects<z.ZodString, string, string> = z
  .string()
  .refine((value: string): boolean => isDayKey(value), {
    message: 'expected a day in YYYY-MM-DD form',
  });

export const gaugeReading = z.number().min(0).max(100);

const addressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().min(1).optional(),
  town: z.string().min(1),
  county: z.string().min(1),
  postalCode: z.string().regex(/^\d{5}(-\d{4})?$/, 'expected a five or nine digit postal code'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const createCustomerSchema = z.object({
  accountNumber: z.string().regex(/^\d{2}-\d{6}$/, 'expected a branch and a six digit serial'),
  billingName: z.string().min(1),
  serviceName: z.string().min(1).optional(),
  address: addressSchema,
  deliveryMode: z.enum(DELIVERY_MODES as unknown as [string, ...string[]]),
  rateClass: z.enum(RATE_CLASSES as unknown as [string, ...string[]]),
  stationId: z.string().min(3),
  openedOn: dayString,
});

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  holdReason: z.string().min(1).nullable().optional(),
});

export const customerQuerySchema = z.object({
  deliveryMode: z.enum(DELIVERY_MODES as unknown as [string, ...string[]]).optional(),
  rateClass: z.enum(RATE_CLASSES as unknown as [string, ...string[]]).optional(),
  stationId: z.string().optional(),
  town: z.string().optional(),
  openOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const createTankSchema = z.object({
  customerId: z.string().min(1),
  serialNumber: z.string().min(1),
  waterCapacity: z
    .number()
    .refine((value) => STOCK_CAPACITIES.includes(value), 'not a tank size on the yard'),
  owner: z.enum(['company', 'customer']),
  setting: z.enum(TANK_SETTINGS as unknown as [string, ...string[]]).optional(),
  fillLimit: z.number().min(10).max(90).optional(),
  reservePercent: z.number().min(0).max(90).optional(),
  appliances: z.array(z.enum(APPLIANCES as unknown as [string, ...string[]])).optional(),
  installedOn: dayString,
  monitorId: z.string().min(1).optional(),
  notes: z.string().optional(),
});

export const postDeliverySchema = z.object({
  ticketNumber: z.string().regex(/^\d{8}$/, 'expected eight digits'),
  customerId: z.string().min(1),
  tankId: z.string().min(1),
  deliveredOn: dayString,
  gross: z.number().min(0),
  meterTemperature: z.number().min(-80).max(160),
  gaugeBefore: gaugeReading.optional(),
  gaugeAfter: gaugeReading.optional(),
  reason: z.enum(FILL_REASONS as unknown as [string, ...string[]]).optional(),
  driverId: z.string().min(1),
  truckId: z.string().min(1),
  notes: z.string().optional(),
});

export const recordReadingSchema = z.object({
  tankId: z.string().min(1),
  takenOn: dayString,
  gauge: gaugeReading,
  source: z.enum(READING_SOURCES as unknown as [string, ...string[]]),
  monitorId: z.string().min(1).optional(),
  note: z.string().optional(),
});

export const observationSchema = z.object({
  day: dayString,
  high: z.number().min(-80).max(160),
  low: z.number().min(-80).max(160),
});

export const observationBatchSchema = z.object({
  stationId: z.string().min(3),
  observations: z.array(observationSchema).min(1).max(400),
});

export const normalsSchema = z.object({
  normals: z
    .array(
      z.object({
        monthDay: z.string().regex(/^\d{2}-\d{2}$/, 'expected MM-DD'),
        heating: z.number().min(0).max(100),
      }),
    )
    .min(1)
    .max(366),
});

export const forecastQuerySchema = z.object({
  asOf: dayString.optional(),
  horizonDays: z.coerce.number().int().min(1).max(365).optional(),
});

export const dispatchQuerySchema = forecastQuerySchema.extend({
  windowDays: z.coerce.number().int().min(0).max(60).optional(),
  maximumStopsPerTruck: z.coerce.number().int().min(1).max(80).optional(),
  returnToYard: z.coerce.boolean().optional(),
});

export const commitPlanSchema = z.object({
  runOn: dayString.optional(),
  drivers: z.record(z.string(), z.string()).optional(),
  replaceExisting: z.boolean().optional(),
});

export const settleStopSchema = z.object({
  tankId: z.string().min(1),
  outcome: z.enum(['delivered', 'no_access', 'not_needed', 'skipped']),
  deliveryId: z.string().min(1).optional(),
  note: z.string().optional(),
});

export const priceQuerySchema = z.object({
  customerId: z.string().min(1),
  gallons: z.coerce.number().min(0),
  on: dayString.optional(),
  taxPercent: z.coerce.number().min(0).max(30).optional(),
  ignoreLock: z.coerce.boolean().optional(),
});

export type CreateCustomerBody = z.infer<typeof createCustomerSchema>;
export type CreateTankBody = z.infer<typeof createTankSchema>;
export type PostDeliveryBody = z.infer<typeof postDeliverySchema>;
export type RecordReadingBody = z.infer<typeof recordReadingSchema>;
export type ObservationBatchBody = z.infer<typeof observationBatchSchema>;

export interface FieldProblem {
  readonly field: string;
  readonly message: string;
}

/** Flattens a zod failure into something an api response can carry. */
export function toFieldProblems(error: z.ZodError): FieldProblem[] {
  return error.issues.map((issue) => ({
    field: issue.path.length === 0 ? '(body)' : issue.path.join('.'),
    message: issue.message,
  }));
}
