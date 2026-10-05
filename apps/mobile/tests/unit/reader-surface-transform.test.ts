import { describe, expect, it } from 'vitest';
import { createReaderSurfaceTransform } from '../../src/reader/skia/rendering/surface-transform';

describe('reader surface coordinate transform', () => {
  it('maps viewport and DisplayList coordinates in both directions', () => {
    const transform = createReaderSurfaceTransform(2, 30, 50);
    expect(transform.toViewportPoint(10, 20)).toEqual({ x: 50, y: 90 });
    expect(transform.toDisplayPoint(50, 90)).toEqual({ x: 10, y: 20 });
  });

  it('uses a finite unit scale for invalid input', () => {
    expect(createReaderSurfaceTransform(0, 0, 0).scale).toBe(1);
  });
});
