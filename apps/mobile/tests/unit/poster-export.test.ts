import { expect, it, vi } from 'vitest';
import { exportPosterPages } from '../../src/features/statistics/domain/poster-export';
it('retries only remaining pages after a partial delivery failure and removes each temporary file', async () => {
  const completed = new Set<number>();
  const capture = vi.fn(async (page: number) => String(page));
  const write = vi.fn(async (_: string, page: number) => `file://${page}.png`);
  const remove = vi.fn(async () => {});
  const deliver = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('album full'));
  const options = {
    pages: [0, 1, 2],
    completed,
    cancelled: () => false,
    capture,
    write,
    remove,
    deliver,
    onSaved: vi.fn(),
  };
  await expect(exportPosterPages(options)).rejects.toThrow('album full');
  expect([...completed]).toEqual([0]);
  expect(remove.mock.calls).toHaveLength(2);
  deliver.mockResolvedValue(undefined);
  await exportPosterPages({ ...options, pages: options.pages.filter((p) => !completed.has(p)) });
  expect([...completed]).toEqual([0, 1, 2]);
  expect(capture.mock.calls.map((c) => c[0])).toEqual([0, 1, 1, 2]);
});
it('cancels between images and does not deliver an image cancelled during capture', async () => {
  let cancelled = false;
  const deliver = vi.fn(async () => {}),
    write = vi.fn(async () => 'file:///image.png');
  const completed = new Set<number>();
  await exportPosterPages({
    pages: [0, 1, 2],
    completed,
    cancelled: () => cancelled,
    capture: async () => {
      cancelled = true;
      return 'base64';
    },
    write,
    deliver,
    remove: async () => {},
    onSaved: () => {},
  });
  expect(write).not.toHaveBeenCalled();
  expect(deliver).not.toHaveBeenCalled();
  expect(completed.size).toBe(0);
});
