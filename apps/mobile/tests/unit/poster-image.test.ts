import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  preparePosterBooks,
  requestPosterPhotoPermission,
  writePosterImage,
  savePosterImage,
  sharePosterImage,
} from '../../src/features/statistics/infrastructure/poster-image';
const mocks = vi.hoisted(() => ({
  size: vi.fn(),
  permission: vi.fn(),
  create: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
  available: vi.fn(),
  share: vi.fn(),
  directory: vi.fn(),
}));
vi.mock('react-native', () => ({ Image: { getSize: mocks.size } }));
vi.mock('expo-media-library', () => ({ requestPermissionsAsync: mocks.permission, Asset: { create: mocks.create } }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: mocks.available, shareAsync: mocks.share }));
vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: mocks.write,
  deleteAsync: mocks.remove,
  readDirectoryAsync: mocks.directory,
}));
const books = Array.from({ length: 120 }, (_, i) => ({
  id: String(i),
  title: String(i),
  author: null,
  coverUri: `file:///${i}.png`,
  milliseconds: 60000,
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});
describe('poster asset preparation and delivery', () => {
  it('collects only old poster files, preserving recent shared images and unrelated cache', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(200000000);
    mocks.directory.mockResolvedValue(['lunar-poster-1-1.png', 'lunar-poster-199999999-1.png', 'other.png']);
    mocks.remove.mockResolvedValue(undefined);
    await writePosterImage('base64', 1);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove).toHaveBeenCalledWith('file:///cache/lunar-poster-1-1.png', { idempotent: true });
    vi.restoreAllMocks();
  });
  it('prepares 120 covers with at most four concurrent requests and preserves order', async () => {
    let active = 0,
      maximum = 0;
    mocks.size.mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return { width: 400, height: 600 };
    });
    expect(await preparePosterBooks(books, { aborted: false })).toEqual(books);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(mocks.size).toHaveBeenCalledTimes(120);
  });
  it('turns missing or timed-out covers into title tiles, preserving books', async () => {
    vi.useFakeTimers();
    mocks.size.mockRejectedValueOnce(Error('missing')).mockImplementationOnce(() => new Promise(() => {}));
    const pending = preparePosterBooks(books.slice(0, 2), { aborted: false });
    await vi.advanceTimersByTimeAsync(10001);
    expect((await pending).map((b) => b.coverUri)).toEqual([null, null]);
  });
  it('stops preparing later batches when cancelled', async () => {
    const signal = { aborted: false };
    mocks.size.mockImplementation(async () => {
      signal.aborted = true;
      return { width: 1, height: 1 };
    });
    await expect(preparePosterBooks(books, signal)).rejects.toThrow('cancelled');
    expect(mocks.size).toHaveBeenCalledTimes(4);
  });
  it('distinguishes permanent permission denial', async () => {
    mocks.permission.mockResolvedValue({ granted: false, canAskAgain: false });
    await expect(requestPosterPhotoPermission()).rejects.toMatchObject({ canAskAgain: false });
    expect(mocks.permission).toHaveBeenCalledWith(true, ['photo']);
  });
  it('cleans a partial cached file if writing fails', async () => {
    mocks.write.mockRejectedValue(Error('disk full'));
    mocks.remove.mockResolvedValue(undefined);
    await expect(writePosterImage('base64', 2)).rejects.toThrow('disk full');
    expect(mocks.remove).toHaveBeenCalledWith(expect.stringMatching(/lunar-poster-.*-2.png$/), { idempotent: true });
  });
  it('uses the real album and PNG system share adapters', async () => {
    mocks.available.mockResolvedValue(true);
    await savePosterImage('file:///poster.png');
    await sharePosterImage('file:///poster.png', '海报');
    expect(mocks.create).toHaveBeenCalledWith('file:///poster.png');
    expect(mocks.share).toHaveBeenCalledWith('file:///poster.png', {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle: '海报',
    });
    mocks.available.mockResolvedValue(false);
    await expect(sharePosterImage('file:///poster.png', '海报')).rejects.toThrow('unavailable');
  });
});
