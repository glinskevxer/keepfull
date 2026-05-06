import { afterEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../../src/service/audit';
import { TankSwapService } from '../../../src/service/tank-swaps';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';

afterEach(closeTestDatabases);

function setup() {
  const scenario = buildScenario({ today: '2026-05-10' });
  return { scenario, service: new TankSwapService(scenario.context) };
}

const newTank = {
  serialNumber: 'TR-990001',
  waterCapacity: 1000,
  owner: 'company' as const,
};

describe('swap', () => {
  it('pulls the old tank and puts a new one on the account', () => {
    const { scenario, service } = setup();
    const result = service.swap({
      outgoingTankId: scenario.tank.id,
      newTank,
      reason: 'undersized',
    });
    expect(result.outgoing.removedOn).toBe('2026-05-10');
    expect(result.incoming.waterCapacity).toBe(1000);
    expect(result.incoming.customerId).toBe(scenario.customer.id);
  });

  it('carries the appliances over', () => {
    const { scenario, service } = setup();
    const result = service.swap({
      outgoingTankId: scenario.tank.id,
      newTank,
      reason: 'undersized',
    });
    expect(result.incoming.appliances).toEqual(scenario.tank.appliances);
  });

  it('credits the gallons left in the old tank', () => {
    const { scenario, service } = setup();
    scenario.read('2026-05-09', 40);
    const result = service.swap({
      outgoingTankId: scenario.tank.id,
      newTank,
      reason: 'undersized',
    });
    expect(result.creditGallons).toBe(200);
  });

  it('credits nothing when nobody read the gauge', () => {
    const { scenario, service } = setup();
    expect(
      service.swap({ outgoingTankId: scenario.tank.id, newTank, reason: 'other' }).creditGallons,
    ).toBe(0);
  });

  it('moves an existing tank off the yard onto the account', () => {
    const { scenario, service } = setup();
    const spare = scenario.addTank({ serialNumber: 'TR-990002', waterCapacity: 1000 });
    const result = service.swap({
      outgoingTankId: scenario.tank.id,
      incomingTankId: spare.id,
      reason: 'undersized',
    });
    expect(result.incoming.id).toBe(spare.id);
  });

  it('frees the monitor so it can move to the new tank', () => {
    const scenario = buildScenario({ today: '2026-05-10' });
    const service = new TankSwapService(scenario.context);
    scenario.context.tanks.update({
      ...scenario.context.tanks.get(scenario.tank.id),
      monitorId: 'WT-1',
    });
    const result = service.swap({
      outgoingTankId: scenario.tank.id,
      newTank: { ...newTank, monitorId: 'WT-1' },
      reason: 'failed_inspection',
    });
    expect(result.outgoing.monitorId).toBeUndefined();
    expect(result.incoming.monitorId).toBe('WT-1');
  });

  it('refuses a tank that has already come out', () => {
    const { scenario, service } = setup();
    service.swap({ outgoingTankId: scenario.tank.id, newTank, reason: 'other' });
    expect(() =>
      service.swap({
        outgoingTankId: scenario.tank.id,
        newTank: { ...newTank, serialNumber: 'TR-990003' },
        reason: 'other',
      }),
    ).toThrowError(/already came out on/);
  });

  it('refuses a swap dated before the tank went in', () => {
    const { scenario, service } = setup();
    expect(() =>
      service.swap({
        outgoingTankId: scenario.tank.id,
        newTank,
        on: dayKey('2018-01-01'),
        reason: 'other',
      }),
    ).toThrowError(/cannot come out before it went in/);
  });

  it('insists on exactly one incoming tank', () => {
    const { scenario, service } = setup();
    expect(() => service.swap({ outgoingTankId: scenario.tank.id, reason: 'other' })).toThrowError(
      /exactly one/,
    );
    const spare = scenario.addTank({ serialNumber: 'TR-990004' });
    expect(() =>
      service.swap({
        outgoingTankId: scenario.tank.id,
        incomingTankId: spare.id,
        newTank,
        reason: 'other',
      }),
    ).toThrowError(/exactly one/);
  });

  it('refuses to swap a tank for itself', () => {
    const { scenario, service } = setup();
    expect(() =>
      service.swap({
        outgoingTankId: scenario.tank.id,
        incomingTankId: scenario.tank.id,
        reason: 'other',
      }),
    ).toThrowError(/swapped for itself/);
  });

  it('writes nothing at all when the swap is refused', () => {
    const { scenario, service } = setup();
    expect(() =>
      service.swap({
        outgoingTankId: scenario.tank.id,
        incomingTankId: scenario.tank.id,
        reason: 'other',
      }),
    ).toThrowError();
    expect(scenario.context.tanks.get(scenario.tank.id).removedOn).toBeUndefined();
  });

  it('leaves an audit entry naming the replacement', () => {
    const { scenario, service } = setup();
    const result = service.swap({
      outgoingTankId: scenario.tank.id,
      newTank,
      reason: 'undersized',
      note: 'grain dryer added',
    });
    const history = new AuditService(scenario.context).history('tank', scenario.tank.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.note).toBe('undersized: grain dryer added');
    expect((history[0]?.after as { replacedBy: string }).replacedBy).toBe(result.incoming.id);
  });

  it('says so in the log', () => {
    const { scenario, service } = setup();
    service.swap({ outgoingTankId: scenario.tank.id, newTank, reason: 'other' });
    expect(scenario.sink.messages()).toContain('swapped a tank');
  });
});

describe('historyIsUsable', () => {
  it('is false on a tank that has never been filled', () => {
    const { scenario, service } = setup();
    expect(service.historyIsUsable(scenario.tank.id)).toEqual({
      usable: false,
      anchoredFills: 0,
    });
  });

  it('is false after one anchored fill', () => {
    const { scenario, service } = setup();
    scenario.fill('2026-04-01', 300);
    expect(service.historyIsUsable(scenario.tank.id).usable).toBe(false);
  });

  it('is true once there are two', () => {
    const { scenario, service } = setup();
    scenario.fill('2026-03-01', 300);
    scenario.fill('2026-04-01', 300);
    expect(service.historyIsUsable(scenario.tank.id)).toEqual({ usable: true, anchoredFills: 2 });
  });

  it('does not count the fill that followed the swap', () => {
    const { scenario, service } = setup();
    scenario.fill('2026-03-01', 300, { reason: 'tank_swap' });
    scenario.fill('2026-04-01', 300);
    expect(service.historyIsUsable(scenario.tank.id).anchoredFills).toBe(1);
  });

  it('does not count a fill that stopped short', () => {
    const { scenario, service } = setup();
    scenario.fill('2026-03-01', 300);
    scenario.fill('2026-04-01', 100, { gaugeAfter: 50 });
    expect(service.historyIsUsable(scenario.tank.id).anchoredFills).toBe(1);
  });
});
