import { afterEach, describe, expect, it } from 'vitest';
import { AuditService, changedFields } from '../../../src/service/audit';
import { DeliveryService } from '../../../src/service/deliveries';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { ticketNumber } from '../../../src/util/ids';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2026-05-04' });
  return { scenario, audit: new AuditService(scenario.context) };
}

describe('changedFields', () => {
  it('keeps only what moved', () => {
    expect(changedFields({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({
      before: { b: 2 },
      after: { b: 3 },
    });
  });

  it('is empty when nothing moved', () => {
    expect(changedFields({ a: 1 }, { a: 1 })).toEqual({ before: {}, after: {} });
  });

  it('spots a field appearing and disappearing', () => {
    expect(changedFields({ a: 1 } as Record<string, unknown>, { a: 1, b: 2 })).toEqual({
      before: { b: undefined },
      after: { b: 2 },
    });
  });

  it('compares nested objects by value', () => {
    expect(changedFields({ a: { x: 1 } }, { a: { x: 1 } })).toEqual({ before: {}, after: {} });
    expect(changedFields({ a: { x: 1 } }, { a: { x: 2 } }).after).toEqual({ a: { x: 2 } });
  });
});

describe('record', () => {
  it('stamps the actor and the request', () => {
    const { audit } = setup();
    const entry = audit.record(
      { actor: 'office screens', requestId: 'req-1' },
      { action: 'create', subjectKind: 'customer', subjectId: 'cus-1' },
    );
    expect(entry.actor).toBe('office screens');
    expect(entry.requestId).toBe('req-1');
    expect(entry.at).toBe('2026-05-04T09:00:00.000Z');
  });

  it('records nothing when a change changed nothing', () => {
    const { audit } = setup();
    expect(
      audit.recordChange({ actor: 'x' }, 'update', 'customer', 'cus-1', { a: 1 }, { a: 1 }),
    ).toBeUndefined();
  });

  it('records only the fields that moved', () => {
    const { audit } = setup();
    const entry = audit.recordChange(
      { actor: 'x' },
      'update',
      'customer',
      'cus-1',
      { a: 1, b: 2 },
      { a: 1, b: 3 },
    );
    expect(entry?.after).toEqual({ b: 3 });
  });

  it('reads a subject history back oldest first', () => {
    const { audit } = setup();
    audit.record({ actor: 'x' }, { action: 'one', subjectKind: 'tank', subjectId: 't-1' });
    audit.record({ actor: 'x' }, { action: 'two', subjectKind: 'tank', subjectId: 't-1' });
    expect(audit.history('tank', 't-1').map((entry) => entry.action)).toEqual(['one', 'two']);
  });

  it('reads what one actor did', () => {
    const { audit } = setup();
    audit.record({ actor: 'a' }, { action: 'one', subjectKind: 'tank', subjectId: 't-1' });
    audit.record({ actor: 'b' }, { action: 'two', subjectKind: 'tank', subjectId: 't-1' });
    expect(audit.byActor('a')).toHaveLength(1);
  });
});

describe('the trail the delivery service leaves', () => {
  it('records a posted ticket', () => {
    const { scenario, audit } = setup();
    const service = new DeliveryService(scenario.context);
    const posted = service.post(
      {
        id: 'dlv-1',
        ticketNumber: ticketNumber(800_001),
        customerId: scenario.customer.id,
        tankId: scenario.tank.id,
        deliveredOn: '2026-05-04',
        gross: 280,
        meterTemperature: 60,
        gaugeBefore: 22,
        gaugeAfter: 80,
        driverId: 'drv-3',
        truckId: 'b-4',
      },
      {},
      { actor: 'handhelds', requestId: 'req-9' },
    );
    const history = audit.history('delivery', posted.delivery.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ action: 'post', actor: 'handhelds', requestId: 'req-9' });
  });

  it('records a void with both sides of the change', () => {
    const { scenario, audit } = setup();
    const service = new DeliveryService(scenario.context);
    const posted = service.post({
      id: 'dlv-1',
      ticketNumber: ticketNumber(800_002),
      customerId: scenario.customer.id,
      tankId: scenario.tank.id,
      deliveredOn: '2026-05-04',
      gross: 280,
      meterTemperature: 60,
      gaugeBefore: 22,
      gaugeAfter: 80,
      driverId: 'drv-3',
      truckId: 'b-4',
    });
    service.void(posted.delivery.id, 'wrong tank', { actor: 'office screens' });
    const history = audit.history('delivery', posted.delivery.id);
    expect(history.map((entry) => entry.action)).toEqual(['post', 'void']);
    expect(history[1]?.before).toMatchObject({ status: 'posted' });
    expect(history[1]?.after).toMatchObject({ status: 'void' });
  });

  it('falls back to the system actor when nobody is named', () => {
    const { scenario, audit } = setup();
    const service = new DeliveryService(scenario.context);
    service.post({
      id: 'dlv-1',
      ticketNumber: ticketNumber(800_003),
      customerId: scenario.customer.id,
      tankId: scenario.tank.id,
      deliveredOn: '2026-05-04',
      gross: 280,
      meterTemperature: 60,
      gaugeBefore: 22,
      gaugeAfter: 80,
      driverId: 'drv-3',
      truckId: 'b-4',
    });
    expect(audit.history('delivery', 'dlv-1')[0]?.actor).toBe('system');
  });
});
