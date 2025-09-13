import { afterEach, describe, expect, it } from 'vitest';
import { DeliveryService } from '../../../src/service/deliveries';
import { ServiceInterruptedError } from '../../../src/core/errors';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { ticketNumber } from '../../../src/util/ids';

afterEach(closeTestDatabases);

let serial = 900_000;

function setup() {
  const scenario = buildScenario({ today: '2025-02-10' });
  return { scenario, service: new DeliveryService(scenario.context) };
}

function ticket(
  scenario: ReturnType<typeof setup>['scenario'],
  overrides: Record<string, unknown> = {},
) {
  serial += 1;
  return {
    id: `d-${serial}`,
    ticketNumber: ticketNumber(serial),
    customerId: scenario.customer.id,
    tankId: scenario.tank.id,
    deliveredOn: '2025-02-10',
    gross: 280,
    meterTemperature: 40,
    gaugeBefore: 22,
    gaugeAfter: 80,
    driverId: 'drv-3',
    truckId: 'b-4',
    ...overrides,
  } as never;
}

describe('post', () => {
  it('writes the ticket and reads back the same net gallons', () => {
    const { scenario, service } = setup();
    const posted = service.post(ticket(scenario));
    expect(scenario.context.deliveries.get(posted.delivery.id).net).toBe(posted.delivery.net);
  });

  it('writes a driver reading from the closing gauge', () => {
    const { scenario, service } = setup();
    service.post(ticket(scenario));
    const reading = scenario.context.readings.latestFor(scenario.tank.id);
    expect(reading?.gauge).toBe(80);
    expect(reading?.source).toBe('driver');
  });

  it('can be told not to write the reading', () => {
    const { scenario, service } = setup();
    service.post(ticket(scenario), { skipReading: true });
    expect(scenario.context.readings.count()).toBe(0);
  });

  it('refuses a tank that belongs to another account', () => {
    const { scenario, service } = setup();
    expect(() => service.post(ticket(scenario, { customerId: 'c-other' }))).toThrowError(
      /no customer with id/,
    );
  });

  it('refuses a drop that would pass the filling limit', () => {
    const { scenario, service } = setup();
    expect(() => service.post(ticket(scenario, { gaugeBefore: 70, gross: 400 }))).toThrowError(
      /passes the filling limit/,
    );
  });

  it('refuses a day before the tank went in', () => {
    const { scenario, service } = setup();
    expect(() => service.post(ticket(scenario, { deliveredOn: '2018-01-01' }))).toThrowError(
      /not in the ground on that day/,
    );
  });

  it('refuses a day that is not a day', () => {
    const { scenario, service } = setup();
    expect(() => service.post(ticket(scenario, { deliveredOn: 'monday' }))).toThrowError(
      /not a delivery day/,
    );
  });

  it('refuses the same ticket number twice', () => {
    const { scenario, service } = setup();
    const first = ticket(scenario);
    service.post(first);
    expect(() => service.post({ ...(first as object), id: 'd-other' } as never)).toThrowError(
      /already been posted/,
    );
  });

  it('writes nothing when the ticket is refused', () => {
    const { scenario, service } = setup();
    expect(() => service.post(ticket(scenario, { gaugeBefore: 70, gross: 400 }))).toThrowError();
    expect(scenario.context.deliveries.list()).toEqual([]);
    expect(scenario.context.readings.count()).toBe(0);
  });

  it('says so in the log', () => {
    const { scenario, service } = setup();
    service.post(ticket(scenario));
    expect(scenario.sink.messages()).toContain('posted a ticket');
  });
});

describe('flags', () => {
  it('is quiet on an ordinary ticket', () => {
    const { scenario, service } = setup();
    expect(service.post(ticket(scenario, { gross: 290, meterTemperature: 60 })).flags).toEqual([]);
  });

  it('notices a gauge that disagrees with the meter', () => {
    const { scenario, service } = setup();
    const posted = service.post(
      ticket(scenario, { gaugeBefore: 22, gaugeAfter: 80, gross: 150, meterTemperature: 60 }),
    );
    expect(posted.flags).toContain('gauge_disagrees_with_meter');
  });

  it('notices a ticket with no gauge readings', () => {
    const { scenario, service } = setup();
    const bare = ticket(scenario) as unknown as Record<string, unknown>;
    delete bare.gaugeBefore;
    delete bare.gaugeAfter;
    expect(service.post(bare as never).flags).toEqual(['no_gauge_readings']);
  });

  it('notices a tank that had run out', () => {
    const { scenario, service } = setup();
    const posted = service.post(
      ticket(scenario, { gaugeBefore: 2, gaugeAfter: 80, gross: 390, meterTemperature: 60 }),
    );
    expect(posted.flags).toContain('was_out_of_gas');
    expect(posted.flags).toContain('unusually_large_drop');
  });

  it('clears the leak check when the tank had run out', () => {
    const scenario = buildScenario({ today: '2025-02-10' });
    const service = new DeliveryService(scenario.context);
    scenario.context.tanks.recordLeakCheck(scenario.tank.id, dayKey('2024-01-01'));
    service.post(
      ticket(scenario, { gaugeBefore: 2, gaugeAfter: 80, gross: 390, meterTemperature: 60 }),
    );
    expect(scenario.context.tanks.get(scenario.tank.id).lastLeakCheckOn).toBeUndefined();
  });

  it('takes a wider tolerance when the caller wants one', () => {
    const { scenario, service } = setup();
    const posted = service.post(
      ticket(scenario, { gaugeBefore: 22, gaugeAfter: 80, gross: 150, meterTemperature: 60 }),
      { gaugeTolerance: 0.9 },
    );
    expect(posted.flags).not.toContain('gauge_disagrees_with_meter');
  });
});

describe('leak checks', () => {
  it('records one', () => {
    const { scenario, service } = setup();
    service.recordLeakCheck(scenario.tank.id, dayKey('2025-02-12'));
    expect(scenario.context.tanks.get(scenario.tank.id).lastLeakCheckOn).toBe('2025-02-12');
    expect(scenario.sink.messages()).toContain('recorded a leak check');
  });

  it('refuses one dated before the tank went in', () => {
    const { scenario, service } = setup();
    expect(() => service.recordLeakCheck(scenario.tank.id, dayKey('2018-01-01'))).toThrowError(
      /cannot predate the tank/,
    );
  });

  it('is happy when the tank never ran out', () => {
    const { scenario, service } = setup();
    service.post(ticket(scenario));
    expect(() =>
      service.assertServiceRestored(scenario.tank.id, dayKey('2025-02-11')),
    ).not.toThrow();
  });

  it('refuses a tank that ran out and was never checked', () => {
    const { scenario, service } = setup();
    service.post(
      ticket(scenario, { gaugeBefore: 2, gaugeAfter: 80, gross: 390, meterTemperature: 60 }),
    );
    expect(() =>
      service.assertServiceRestored(scenario.tank.id, dayKey('2025-02-11')),
    ).toThrowError(ServiceInterruptedError);
  });

  it('is satisfied once the check is recorded', () => {
    const { scenario, service } = setup();
    service.post(
      ticket(scenario, { gaugeBefore: 2, gaugeAfter: 80, gross: 390, meterTemperature: 60 }),
    );
    service.recordLeakCheck(scenario.tank.id, dayKey('2025-02-10'));
    expect(() =>
      service.assertServiceRestored(scenario.tank.id, dayKey('2025-02-11')),
    ).not.toThrow();
  });

  it('is happy about a tank that has never been filled at all', () => {
    const { scenario, service } = setup();
    expect(() => service.assertServiceRestored(scenario.tank.id)).not.toThrow();
  });
});

describe('other entries', () => {
  it('voids a ticket with a note', () => {
    const { scenario, service } = setup();
    const posted = service.post(ticket(scenario));
    const gone = service.void(posted.delivery.id, 'wrong tank');
    expect(gone.status).toBe('void');
    expect(scenario.sink.messages()).toContain('voided a ticket');
  });

  it('records a gauge a customer read out', () => {
    const { scenario, service } = setup();
    service.recordCustomerReading(scenario.tank.id, dayKey('2025-02-09'), 35);
    const reading = scenario.context.readings.latestFor(scenario.tank.id);
    expect(reading?.source).toBe('customer');
    expect(reading?.gauge).toBe(35);
  });

  it('refuses a reading against a tank it does not know', () => {
    const { service } = setup();
    expect(() => service.recordCustomerReading('t-nope', dayKey('2025-02-09'), 35)).toThrowError(
      /no tank with id/,
    );
  });

  it('refuses a gauge off the dial', () => {
    const { scenario, service } = setup();
    expect(() =>
      service.recordCustomerReading(scenario.tank.id, dayKey('2025-02-09'), 140),
    ).toThrowError(/between 0 and 100/);
  });
});
