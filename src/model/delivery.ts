import { DayKey, dayKey, isDayKey } from '../util/dates';
import { InvalidInputError } from '../core/errors';
import {
  Fahrenheit,
  GrossGallons,
  NetGallons,
  fahrenheit,
  grossGallons,
  percent,
} from '../core/units';
import { Percent } from '../core/units';
import { assertNonEmpty } from '../util/assert';
import { isValidTicketNumber } from '../util/ids';
import { toNetGallons } from '../core/volume-correction';

/**
 * A delivery ticket. This is the record of record: it is what the customer
 * signed, what the meter said, and what the burn model reads back.
 *
 * The gauge readings before and after matter more than people expect. A fill
 * that stopped short because the driver ran out of product on the truck cannot
 * be used to fit a burn rate, because the interval that follows it starts from
 * an unknown level. Only fills that ended at the tank's filling limit anchor
 * the model, and `isAnchorFill` is what decides that.
 */

export type FillReason =
  | 'scheduled'
  | 'will_call'
  | 'emergency'
  | 'new_tank'
  | 'tank_swap'
  | 'top_off';

export const FILL_REASONS: readonly FillReason[] = [
  'scheduled',
  'will_call',
  'emergency',
  'new_tank',
  'tank_swap',
  'top_off',
];

export type DeliveryStatus = 'posted' | 'void';

/** How close to the filling limit still counts as a full fill. */
export const ANCHOR_TOLERANCE_PERCENT = 3;

export interface Delivery {
  readonly id: string;
  readonly ticketNumber: string;
  readonly customerId: string;
  readonly tankId: string;
  readonly deliveredOn: DayKey;
  readonly gross: GrossGallons;
  readonly meterTemperature: Fahrenheit;
  readonly net: NetGallons;
  readonly gaugeBefore?: Percent;
  readonly gaugeAfter?: Percent;
  readonly reason: FillReason;
  readonly status: DeliveryStatus;
  readonly driverId: string;
  readonly truckId: string;
  readonly notes?: string;
}

export interface DeliveryDraft {
  readonly id: string;
  readonly ticketNumber: string;
  readonly customerId: string;
  readonly tankId: string;
  readonly deliveredOn: string;
  readonly gross: number;
  readonly meterTemperature: number;
  readonly gaugeBefore?: number;
  readonly gaugeAfter?: number;
  readonly reason?: FillReason;
  readonly status?: DeliveryStatus;
  readonly driverId: string;
  readonly truckId: string;
  readonly notes?: string;
}

export function makeDelivery(draft: DeliveryDraft): Delivery {
  assertNonEmpty(draft.id, 'delivery id');
  assertNonEmpty(draft.customerId, 'customer id');
  assertNonEmpty(draft.tankId, 'tank id');
  assertNonEmpty(draft.driverId, 'driver id');
  assertNonEmpty(draft.truckId, 'truck id');
  if (!isValidTicketNumber(draft.ticketNumber)) {
    throw new InvalidInputError(`ticket number ${draft.ticketNumber} does not check out`, {
      ticketNumber: draft.ticketNumber,
    });
  }
  if (!isDayKey(draft.deliveredOn)) {
    throw new InvalidInputError(`"${draft.deliveredOn}" is not a delivery day`);
  }
  const reason = draft.reason ?? 'scheduled';
  if (!FILL_REASONS.includes(reason)) {
    throw new InvalidInputError(`"${reason}" is not a reason to fill a tank`);
  }
  const status = draft.status ?? 'posted';
  if (status !== 'posted' && status !== 'void') {
    throw new InvalidInputError(`"${status}" is not a ticket status`);
  }
  const gross = grossGallons(draft.gross);
  const meterTemperature = fahrenheit(draft.meterTemperature);
  const gaugeBefore = draft.gaugeBefore === undefined ? undefined : percent(draft.gaugeBefore);
  const gaugeAfter = draft.gaugeAfter === undefined ? undefined : percent(draft.gaugeAfter);
  if (gaugeBefore !== undefined && gaugeAfter !== undefined && gaugeAfter < gaugeBefore) {
    throw new InvalidInputError('the tank cannot read lower after a fill than before it', {
      gaugeBefore,
      gaugeAfter,
    });
  }
  return {
    id: draft.id,
    ticketNumber: draft.ticketNumber,
    customerId: draft.customerId,
    tankId: draft.tankId,
    deliveredOn: dayKey(draft.deliveredOn),
    gross,
    meterTemperature,
    net: toNetGallons(gross, meterTemperature),
    ...(gaugeBefore === undefined ? {} : { gaugeBefore }),
    ...(gaugeAfter === undefined ? {} : { gaugeAfter }),
    reason,
    status,
    driverId: draft.driverId,
    truckId: draft.truckId,
    ...(draft.notes ? { notes: draft.notes } : {}),
  };
}

export function isPosted(delivery: Delivery): boolean {
  return delivery.status === 'posted';
}

/**
 * Whether this fill topped the tank out. Only anchored fills can start or end
 * an interval the burn model is allowed to fit against.
 */
export function isAnchorFill(delivery: Delivery, fillLimit: number): boolean {
  if (!isPosted(delivery)) {
    return false;
  }
  if (delivery.reason === 'new_tank' || delivery.reason === 'tank_swap') {
    return false;
  }
  if (delivery.gaugeAfter === undefined) {
    return false;
  }
  return delivery.gaugeAfter >= fillLimit - ANCHOR_TOLERANCE_PERCENT;
}

/** How much the gauge moved, when both readings were taken. */
export function gaugeRise(delivery: Delivery): number | undefined {
  if (delivery.gaugeBefore === undefined || delivery.gaugeAfter === undefined) {
    return undefined;
  }
  return delivery.gaugeAfter - delivery.gaugeBefore;
}

/**
 * Net gallons implied by the gauge movement. Comparing this against the metered
 * net is the cheapest check there is on a mis-set meter or a fabricated ticket.
 */
export function impliedNetGallons(delivery: Delivery, waterCapacity: number): number | undefined {
  const rise = gaugeRise(delivery);
  return rise === undefined ? undefined : (rise / 100) * waterCapacity;
}

export function voided(delivery: Delivery, note: string): Delivery {
  assertNonEmpty(note, 'void note');
  return { ...delivery, status: 'void', notes: note };
}

export function compareByDay(left: Delivery, right: Delivery): number {
  if (left.deliveredOn === right.deliveredOn) {
    return left.ticketNumber < right.ticketNumber ? -1 : 1;
  }
  return left.deliveredOn < right.deliveredOn ? -1 : 1;
}
