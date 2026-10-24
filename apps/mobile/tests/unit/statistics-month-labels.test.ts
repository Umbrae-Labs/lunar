import { describe, expect, it } from 'vitest';
import {
  heatmapDimensions,
  layoutMonthLabels,
  monthLabelOpacity,
} from '../../src/features/statistics/domain/month-labels';

describe('heatmap month label spacing', () => {
  it('hides partially clipped labels at both edges of a narrow scrolling viewport', () => {
    const labels = layoutMonthLabels(
      [
        { date: '2026-08-01', column: 0, width: 24 },
        { date: '2026-09-01', column: 5, width: 24 },
        { date: '2026-10-01', column: 9, width: 30 },
      ],
      18,
      220,
      8,
      { left: 12, width: 170 },
    );
    expect(labels.map((label) => label.date)).toEqual(['2026-09-01']);
  });
  it('reserves enough row height and weekday width when system fonts grow on narrow screens', () => {
    for (const width of [320, 360, 411])
      for (const scale of [1, 1.3, 2]) {
        const { weekdayWidth, cellSize, rowHeight } = heatmapDimensions(width - 32, scale);
        expect(rowHeight).toBeGreaterThanOrEqual(16 * scale);
        expect(weekdayWidth).toBeGreaterThanOrEqual(24 * scale);
        expect(rowHeight).toBe(cellSize);
        expect(weekdayWidth + 8 + cellSize + 40).toBeLessThan(width - 32);
      }
  });
  it('keeps calendar week anchors without overlapping at normal and narrow widths', () => {
    for (const cell of [12, 19, 24]) {
      const labels = layoutMonthLabels(
        [
          { date: '2026-08-01', column: 1, width: 23 },
          { date: '2026-09-01', column: 6, width: 23 },
          { date: '2026-10-01', column: 10, width: 28 },
        ],
        cell + 4,
        cell * 13 + 48,
      );
      expect(labels).toHaveLength(3);
      expect(labels.map((label) => label.left)).toEqual([1, 6, 10].map((column) => column * (cell + 4)));
    }
  });
  it('hides an earlier label when enlarged text collides, keeping the newer month', () => {
    expect(
      layoutMonthLabels(
        [
          { date: '2026-08-01', column: 1, width: 95 },
          { date: '2026-09-01', column: 6, width: 80 },
          { date: '2026-10-01', column: 10, width: 35 },
        ],
        16,
        204,
      ).map((label) => label.date),
    ).toEqual(['2026-08-01', '2026-10-01']);
  });
  it('hides unmeasured or clipped labels instead of shifting their calendar anchors', () => {
    expect(
      layoutMonthLabels(
        [
          { date: '2026-12-01', column: 0, width: 0 },
          { date: '2027-01-01', column: 12, width: 25 },
        ],
        16,
        204,
      ),
    ).toEqual([]);
  });
});

describe('scroll-driven whole-month fading', () => {
  it('never shows a clipped label, including subpixel positions and enlarged text', () => {
    for (const width of [18, 28, 52])
      for (let offset = -10; offset < 810; offset += 0.25) {
        const opacity = monthLabelOpacity(90, width, offset, 200, 1000);
        const actual = Math.max(0, Math.min(800, offset));
        expect(opacity).toBeGreaterThanOrEqual(0);
        expect(opacity).toBeLessThanOrEqual(1);
        if (90 < actual || 90 + width > actual + 200) expect(opacity).toBe(0);
      }
  });
  it('fades continuously before clipping and retraces exactly when reversing', () => {
    const positions = [82, 83, 84, 85, 86, 87, 88, 89, 90, 600, 20, 85, 89];
    const opacity = positions.map((x) => monthLabelOpacity(90, 24, x, 200, 1000));
    expect(opacity.slice(0, 8)).toEqual([...opacity.slice(0, 8)].sort((a, b) => b - a));
    expect(opacity[0]).toBe(1);
    expect(opacity[7]).toBe(0);
    expect(opacity[3]).toBe(opacity[11]);
    expect(opacity[7]).toBe(opacity[12]);
    for (let i = 0; i < 500; i++) expect(monthLabelOpacity(90, 24, 85, 200, 1000)).toBe(opacity[3]);
  });
  it('keeps edge guards stable during overscroll and hides unmeasured viewports', () => {
    expect(monthLabelOpacity(0, 24, -12, 200, 1000)).toBe(0);
    expect(monthLabelOpacity(976, 24, 812, 200, 1000)).toBe(0);
    expect(monthLabelOpacity(90, 24, 0, 0, 1000)).toBe(0);
    expect(monthLabelOpacity(90, 0, 0, 200, 1000)).toBe(0);
    expect(monthLabelOpacity(90, 24, 0, 1200, 1000)).toBe(1);
  });
});
