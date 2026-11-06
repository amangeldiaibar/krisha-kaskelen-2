import { describe, expect, it } from 'vitest';
import { fitView, project, spreadPins } from './mapView.js';

const points = [
  { lat: 43.207176, lon: 76.66967 },
  { lat: 43.197572, lon: 76.644439 },
  { lat: 43.207631, lon: 76.638976 },
];

describe('fitView', () => {
  it('keeps every point inside the image', () => {
    const view = fitView(points, 800, 340);
    for (const point of points) {
      const { x, y } = project(point, view, 800, 340);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(800);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(340);
    }
  });

  it('matches the scale measured on 2GIS images', () => {
    const view = { center: { lat: 43.2, lon: 76.62 }, zoom: 14 };
    const { x } = project({ lat: 43.2, lon: 76.63 }, view, 600, 200);
    expect(Math.round(x - 300)).toBe(117);
  });
});

describe('spreadPins', () => {
  it('separates overlapping pins and keeps the input order', () => {
    const result = spreadPins([{ x: 100, y: 100 }, { x: 110, y: 105 }, { x: 400, y: 100 }]);
    expect(Math.abs(result[0].x - result[1].x)).toBeGreaterThanOrEqual(46);
    expect(result[2]).toEqual({ x: 400, y: 100 });
  });
});
