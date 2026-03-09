import { describe, expect, it } from 'vitest';
import { driftTrend, reconcile, toleranceFor } from '../../../src/core/reconcile';

describe('toleranceFor', () => {
  it('is the absolute floor on a small load', () => {
    expect(toleranceFor(100)).toBe(15);
  });

  it('grows with the load once the relative share takes over', () => {
    expect(toleranceFor(6000)).toBe(30);
  });

  it('takes overrides', () => {
    expect(toleranceFor(2000, { relative: 0.01, absolute: 5 })).toBe(20);
  });

  it('refuses a negative tolerance', () => {
    expect(() => toleranceFor(100, { absolute: -1 })).toThrowError(/absolute tolerance/);
    expect(() => toleranceFor(100, { relative: -1 })).toThrowError(/relative tolerance/);
  });
});

describe('reconcile', () => {
  it('is clean when all three agree', () => {
    const result = reconcile(2400, 2398, 2396, 8);
    expect(result.verdict).toBe('clean');
    expect(result.withinTolerance).toBe(true);
  });

  it('blames the meter when plant and truck disagree but tickets match the truck', () => {
    const result = reconcile(2400, 2300, 2298, 8);
    expect(result.verdict).toBe('meter_drift');
    expect(result.plantVsMetered).toBe(100);
  });

  it('blames the paperwork when the truck and tickets disagree', () => {
    const result = reconcile(2400, 2398, 2200, 7);
    expect(result.verdict).toBe('paperwork');
    expect(result.meteredVsTicketed).toBe(198);
  });

  it('reports both when both gaps are out', () => {
    expect(reconcile(2400, 2200, 2000, 6).verdict).toBe('both');
  });

  it('cannot judge an open shift', () => {
    const result = reconcile(2400, null, 2200, 7);
    expect(result.verdict).toBe('incomplete');
    expect(result.withinTolerance).toBe(false);
    expect(result.plantVsMetered).toBeNull();
  });

  it('refuses negative gallons', () => {
    expect(() => reconcile(-1, 100, 100, 1)).toThrowError(/plant gallons/);
    expect(() => reconcile(100, 100, -1, 1)).toThrowError(/ticketed gallons/);
  });

  it('widens with a looser tolerance', () => {
    expect(reconcile(2400, 2300, 2298, 8, { absolute: 200 }).verdict).toBe('clean');
  });
});

describe('driftTrend', () => {
  it('says nothing about a short run', () => {
    expect(driftTrend([5, 4, 6])).toMatchObject({ direction: 'none', run: 3 });
  });

  it('calls a long run in one direction', () => {
    const trend = driftTrend([4, 6, 5, 7, 5, 6]);
    expect(trend.direction).toBe('lean');
    expect(trend.run).toBe(6);
  });

  it('calls the other direction rich', () => {
    expect(driftTrend([-4, -6, -5, -7, -5]).direction).toBe('rich');
  });

  it('resets the run when the sign flips', () => {
    expect(driftTrend([5, 5, 5, 5, -5]).run).toBe(1);
  });

  it('treats an exact zero as breaking the run', () => {
    expect(driftTrend([5, 5, 5, 5, 0]).direction).toBe('none');
  });

  it('reports the mean gap over the whole window', () => {
    expect(driftTrend([4, 6]).meanGap).toBe(5);
  });

  it('has nothing to say about no days at all', () => {
    expect(driftTrend([])).toEqual({ run: 0, direction: 'none', meanGap: 0 });
  });

  it('takes a different minimum run', () => {
    expect(driftTrend([5, 5], 2).direction).toBe('lean');
  });
});
