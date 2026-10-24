import { expect, it } from 'vitest';
import { clampPosterCamera, fitPosterCamera } from '../../src/features/statistics/domain/poster-camera';

it('fits an entire normal or long poster inside a narrow viewport', () => {
  for (const height of [1440, 6442]) {
    const camera = fitPosterCamera(1080, height, 320, 440);
    expect(camera.x).toBeGreaterThanOrEqual(12);
    expect(camera.y).toBeGreaterThanOrEqual(12);
    expect(camera.x + 1080 * camera.scale).toBeLessThanOrEqual(308.0001);
    expect(camera.y + height * camera.scale).toBeLessThanOrEqual(428.0001);
  }
});
it('bounds zoom and panning without losing the poster off-screen', () => {
  const fit = fitPosterCamera(1080, 1440, 320, 440);
  expect(clampPosterCamera({ x: -9000, y: 9000, scale: 0.001 }, 1080, 1440, 320, 440)).toEqual(fit);
  const edge = clampPosterCamera({ x: 9000, y: -9000, scale: fit.scale * 100 }, 1080, 1440, 320, 440);
  expect(edge.scale).toBe(fit.scale * 8);
  expect(edge.x).toBe(12);
  expect(edge.y + 1440 * edge.scale).toBe(428);
  const reverse = clampPosterCamera({ ...edge, x: edge.x - 10, y: edge.y + 10 }, 1080, 1440, 320, 440);
  expect(reverse.x).toBe(2);
  expect(reverse.y).toBe(edge.y + 10);
});
