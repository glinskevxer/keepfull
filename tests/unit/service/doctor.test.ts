import { afterEach, describe, expect, it } from 'vitest';
import { DoctorService } from '../../../src/service/doctor';
import { aCustomer } from '../../support/fixtures';
import { buildScenario } from '../../support/scenario';
import { closeTestDatabases } from '../../support/db';
import { dayKey } from '../../../src/util/dates';
import { loadSettings } from '../../../src/config/env';
import { makeDriver, makeSchedule, makeTruckFixture } from './doctor-fixtures';

afterEach(closeTestDatabases);

const settings = loadSettings({
  YARD_LATITUDE: '42.4432',
  YARD_LONGITUDE: '-76.5019',
  LOG_LEVEL: 'error',
} as NodeJS.ProcessEnv);

/** A yard with nothing wrong with it, as a starting point for each case. */
function healthy() {
  const scenario = buildScenario({ today: '2026-07-16', weatherTo: '2026-07-16' });
  scenario.context.fleet.saveTruck(makeTruckFixture());
  scenario.context.fleet.saveDriver(
    makeDriver({ id: 'drv-1', name: 'R Vandemark', licenceNumber: 'NY-1' }),
  );
  scenario.context.pricing.saveSchedule(
    makeSchedule({ rateClass: 'agricultural', effectiveFrom: dayKey('2026-01-01') }),
  );
  return { scenario, service: new DoctorService(scenario.context, settings) };
}

describe('diagnose', () => {
  it('finds nothing wrong with a healthy yard', () => {
    const { service } = healthy();
    const diagnosis = service.diagnose();
    expect(diagnosis.findings).toEqual([]);
    expect(diagnosis.healthy).toBe(true);
  });

  it('blocks on weather that has stopped arriving', () => {
    const scenario = buildScenario({ today: '2026-07-16', weatherTo: '2026-07-01' });
    scenario.context.fleet.saveTruck(makeTruckFixture());
    const diagnosis = new DoctorService(scenario.context, settings).diagnose();
    expect(diagnosis.healthy).toBe(false);
    expect(diagnosis.findings.some((finding) => finding.detail.includes('nothing since'))).toBe(
      true,
    );
  });

  it('blocks on an account pointed at a station that is gone', () => {
    const { scenario, service } = healthy();
    scenario.context.customers.insert(aCustomer({ stationId: 'KBUF' }));
    const diagnosis = service.diagnose();
    expect(diagnosis.blocking).toBeGreaterThan(0);
    expect(diagnosis.findings.some((finding) => finding.detail.includes('KBUF'))).toBe(true);
  });

  it('blocks when there is no bobtail', () => {
    const { scenario, service } = healthy();
    scenario.context.fleet.retireTruck('trk-b4');
    expect(service.diagnose().findings.some((finding) => finding.check === 'fleet')).toBe(true);
  });

  it('warns when a rate class has no price in force', () => {
    const { scenario, service } = healthy();
    scenario.context.customers.update({ ...scenario.customer, rateClass: 'commercial' });
    const diagnosis = service.diagnose();
    expect(diagnosis.blocking).toBe(0);
    expect(diagnosis.warnings).toBeGreaterThan(0);
    expect(diagnosis.findings[0]?.detail).toMatch(/no price schedule in force for commercial/);
  });

  it('warns when a station has no normal year', () => {
    const scenario = buildScenario({ today: '2026-07-16', weatherTo: '2026-07-16' });
    scenario.context.fleet.saveTruck(makeTruckFixture());
    scenario.context.fleet.saveDriver(
      makeDriver({ id: 'drv-1', name: 'R Vandemark', licenceNumber: 'NY-1' }),
    );
    scenario.context.db.prepare('DELETE FROM degree_day_normals').run();
    const diagnosis = new DoctorService(scenario.context, settings).diagnose();
    expect(diagnosis.findings.some((finding) => finding.detail.includes('no normal year'))).toBe(
      true,
    );
  });

  it('warns about a yard coordinate that cannot be right', () => {
    const wrong = loadSettings({
      YARD_LATITUDE: '42.4432',
      YARD_LONGITUDE: '76.5019',
      LOG_LEVEL: 'error',
    } as NodeJS.ProcessEnv);
    const { scenario } = healthy();
    const diagnosis = new DoctorService(scenario.context, wrong).diagnose();
    expect(diagnosis.findings.some((finding) => finding.check === 'yard')).toBe(true);
  });

  it('says nothing about the yard when it has no settings to check against', () => {
    const { scenario } = healthy();
    expect(
      new DoctorService(scenario.context).diagnose().findings.some((f) => f.check === 'yard'),
    ).toBe(false);
  });
});
