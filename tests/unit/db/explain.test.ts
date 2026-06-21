import { afterEach, describe, expect, it } from 'vitest';
import { describePlan, explain, indexesUsed, scansTable } from '../../../src/db/explain';
import { closeTestDatabases, testDatabase } from '../../support/db';

afterEach(closeTestDatabases);

describe('explain', () => {
  it('reports the steps the planner would take', () => {
    const plan = explain(testDatabase(), 'SELECT * FROM customers');
    expect(plan.length).toBeGreaterThan(0);
    expect(describePlan(plan)).toMatch(/customers/);
  });
});

describe('the indexes migration ten added', () => {
  it('keeps the burn model off a full scan of the tickets', () => {
    const plan = explain(
      testDatabase(),
      "SELECT * FROM deliveries WHERE tank_id = ? AND status = 'posted' ORDER BY delivered_on",
      ['t-1'],
    );
    expect(scansTable(plan, 'deliveries')).toBe(false);
    expect(indexesUsed(plan)).toContain('deliveries_tank_posted');
  });

  it('lets the monitor health job find the newest reading by index', () => {
    const plan = explain(
      testDatabase(),
      "SELECT * FROM tank_readings WHERE tank_id = ? AND source = 'monitor' ORDER BY taken_on DESC LIMIT 1",
      ['t-1'],
    );
    expect(scansTable(plan, 'tank_readings')).toBe(false);
    expect(indexesUsed(plan)).toContain('tank_readings_tank_source_day');
  });

  it('keeps the compliance sweep off a full scan of the tanks', () => {
    const plan = explain(
      testDatabase(),
      'SELECT * FROM tanks WHERE customer_id = ? AND removed_on IS NULL',
      ['c-1'],
    );
    expect(scansTable(plan, 'tanks')).toBe(false);
  });

  it('joins route stops back to their tickets by index', () => {
    const plan = explain(testDatabase(), 'SELECT * FROM route_stops WHERE delivery_id = ?', [
      'dlv-1',
    ]);
    expect(indexesUsed(plan)).toContain('route_stops_delivery');
  });
});

describe('the helpers', () => {
  it('spots a scan', () => {
    expect(scansTable([{ id: 1, parent: 0, detail: 'SCAN tanks' }], 'tanks')).toBe(true);
    expect(scansTable([{ id: 1, parent: 0, detail: 'SEARCH tanks' }], 'tanks')).toBe(false);
  });

  it('pulls the index names out, covering ones included', () => {
    expect(
      indexesUsed([
        { id: 1, parent: 0, detail: 'SEARCH tanks USING INDEX tanks_customer (customer_id=?)' },
        { id: 2, parent: 0, detail: 'SEARCH t USING COVERING INDEX x (a=?)' },
      ]),
    ).toEqual(['tanks_customer', 'x']);
  });

  it('has nothing to report for a plan with no indexes', () => {
    expect(indexesUsed([{ id: 1, parent: 0, detail: 'SCAN tanks' }])).toEqual([]);
  });
});
