import { describe, expect, it } from 'vitest';
import { readingCurve } from '../../src/features/statistics/domain/curve';

describe('reading trend geometry', () => {
  it('keeps one-day and three-day periods honest and handles empty periods', () => {
    expect(readingCurve([], 200, 140, 30)).toEqual({ points: [], path: '' });
    expect(readingCurve([0], 200, 140, 30).points).toEqual([{ x: 100, y: 140 }]);
    expect(readingCurve([0, 30, 0], 200, 140, 30).path).toBe('M 0 140 L 100 0 L 200 140');
  });
  it('keeps every smooth segment inside its real endpoint values, including zero days', () => {
    const { points, path } = readingCurve([0, 10, 40, 5, 0, 0, 30], 240, 140, 40);
    const segments = [...path.matchAll(/C ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)/g)];
    expect(segments).toHaveLength(6);
    segments.forEach((segment, index) => {
      const start = points[index].y,
        end = points[index + 1].y;
      const a = Number(segment[2]),
        b = Number(segment[4]);
      for (let step = 0; step <= 100; step++) {
        const t = step / 100;
        const y = (1 - t) ** 3 * start + 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3 * end;
        expect(y).toBeGreaterThanOrEqual(Math.min(start, end) - 1e-8);
        expect(y).toBeLessThanOrEqual(Math.max(start, end) + 1e-8);
      }
    });
  });
});
