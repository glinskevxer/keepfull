import { describe, expect, it } from 'vitest';
import {
  DistanceMatrix,
  Point,
  ROAD_FACTOR,
  checkPoint,
  roadMiles,
  straightLineMiles,
} from '../../../../src/core/route/distance';

const yard: Point = { latitude: 42.4432, longitude: -76.5019 };
const danby: Point = { latitude: 42.3406, longitude: -76.4901 };
const newfield: Point = { latitude: 42.3595, longitude: -76.5949 };
const dryden: Point = { latitude: 42.4948, longitude: -76.2971 };

describe('straightLineMiles', () => {
  it('is zero between a point and itself', () => {
    expect(straightLineMiles(yard, yard)).toBe(0);
  });

  it('is symmetric', () => {
    expect(straightLineMiles(yard, danby)).toBeCloseTo(straightLineMiles(danby, yard), 9);
  });

  it('gets a known short hop about right', () => {
    expect(straightLineMiles(yard, danby)).toBeCloseTo(7.1, 1);
  });

  it('gets a degree of latitude about right', () => {
    expect(
      straightLineMiles({ latitude: 42, longitude: -76 }, { latitude: 43, longitude: -76 }),
    ).toBeCloseTo(69.1, 1);
  });

  it('refuses a point off the globe', () => {
    expect(() => straightLineMiles({ latitude: 95, longitude: 0 }, yard)).toThrowError(
      /from latitude/,
    );
    expect(() => straightLineMiles(yard, { latitude: 0, longitude: 200 })).toThrowError(
      /to longitude/,
    );
  });
});

describe('roadMiles', () => {
  it('scales the straight line', () => {
    expect(roadMiles(yard, danby)).toBeCloseTo(straightLineMiles(yard, danby) * ROAD_FACTOR, 9);
  });

  it('takes a different factor', () => {
    expect(roadMiles(yard, danby, 1)).toBeCloseTo(straightLineMiles(yard, danby), 9);
  });

  it('refuses a factor of zero', () => {
    expect(() => roadMiles(yard, danby, 0)).toThrowError(/road factor/);
  });
});

describe('checkPoint', () => {
  it('passes a good point through', () => {
    expect(checkPoint(yard)).toBe(yard);
  });

  it('names the label in the message', () => {
    expect(() => checkPoint({ latitude: 91, longitude: 0 }, 'stop 3')).toThrowError(
      /stop 3 latitude/,
    );
  });
});

describe('DistanceMatrix', () => {
  const matrix = new DistanceMatrix([yard, danby, newfield, dryden]);

  it('knows its size', () => {
    expect(matrix.size).toBe(4);
  });

  it('has a zero diagonal', () => {
    for (let index = 0; index < matrix.size; index += 1) {
      expect(matrix.between(index, index)).toBe(0);
    }
  });

  it('is symmetric', () => {
    expect(matrix.between(1, 3)).toBeCloseTo(matrix.between(3, 1), 9);
  });

  it('matches the pairwise function', () => {
    expect(matrix.between(0, 1)).toBeCloseTo(roadMiles(yard, danby), 9);
  });

  it('refuses an index that is not a stop', () => {
    expect(() => matrix.between(0, 9)).toThrowError(/no stop at index 9/);
    expect(() => matrix.between(-1, 0)).toThrowError(/no stop at index -1/);
  });

  it('handles an empty and a single point matrix', () => {
    expect(new DistanceMatrix([]).size).toBe(0);
    expect(new DistanceMatrix([yard]).tourLength([0])).toBe(0);
  });
});

describe('tourLength', () => {
  const matrix = new DistanceMatrix([yard, danby, newfield, dryden]);

  it('adds up the legs', () => {
    expect(matrix.tourLength([0, 1, 2])).toBeCloseTo(
      matrix.between(0, 1) + matrix.between(1, 2),
      9,
    );
  });

  it('closes the loop when asked', () => {
    expect(matrix.tourLength([0, 1, 2], { closed: true })).toBeCloseTo(
      matrix.tourLength([0, 1, 2]) + matrix.between(2, 0),
      9,
    );
  });

  it('is zero for a tour of one stop or none', () => {
    expect(matrix.tourLength([])).toBe(0);
    expect(matrix.tourLength([2])).toBe(0);
  });
});

describe('nearest', () => {
  const matrix = new DistanceMatrix([yard, danby, newfield, dryden]);

  it('finds the closest unvisited stop', () => {
    expect(matrix.nearest(0, new Set())).toBe(1);
  });

  it('skips what has been visited', () => {
    expect(matrix.nearest(0, new Set([1, 2]))).toBe(3);
  });

  it('has nothing left to give when everything is visited', () => {
    expect(matrix.nearest(0, new Set([1, 2, 3]))).toBeUndefined();
  });
});
