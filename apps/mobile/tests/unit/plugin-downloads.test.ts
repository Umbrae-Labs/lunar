import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DOWNLOAD_LIMITS } from '../../src/features/plugins/services/plugin-download-queue';
import { createTestHost, manifest, memoryDownloads, plugin, sha256 } from './plugin-test-support';

const PLUGIN_ID = 'org.example.test';

const downloadManifest = (permissions: readonly string[] = ['library.import', 'network']) =>
  manifest({
    permissions: permissions.map((name) => ({ name, reason: name })),
    contributes: { downloads: [{ id: 'volume', title: 'Volume' }] },
  });

/** A plugin whose entry stores its context on `globalThis.__ctx` and registers `body` as its handler. */
const entry = (body: string) =>
  `exports.default = { activate(ctx) { globalThis.__ctx = ctx; ctx.downloads.register('volume', ${body}); } };`;

type TestContext = import('@umbrae-labs/lunar-plugin-sdk').PluginContext;
const context = () => (globalThis as { __ctx?: TestContext }).__ctx!;
const state = globalThis as { __runs?: number; __attempts?: unknown[]; __checkpoints?: unknown[] };

async function start(
  handler: string,
  options: { readonly downloads?: ReturnType<typeof memoryDownloads>; readonly permissions?: readonly string[] } = {},
) {
  const downloads = options.downloads ?? memoryDownloads();
  const { host, deps } = createTestHost({
    downloads: { ...downloads, sha256: async (bytes: Uint8Array) => sha256(bytes) },
  });
  host.setPlugins([
    { plugin: plugin(entry(handler), { manifest: downloadManifest(options.permissions) }), enabled: true },
  ]);
  expect(await host.ensureActive(PLUGIN_ID)).toBe(true);
  return { host, deps, downloads };
}

/** Advances fake time in small steps until the condition holds. */
async function until(condition: () => boolean) {
  for (let step = 0; step < 200 && !condition(); step += 1) await vi.advanceTimersByTimeAsync(10);
  expect(condition()).toBe(true);
}

describe('plugin downloads', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.__runs = 0;
    state.__attempts = [];
    state.__checkpoints = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a download, imports its EPUB and forgets its files', async () => {
    const { host, deps, downloads } = await start(`async (job) => {
      job.progress({ completed: 1, total: 2, label: 'Chapter 1' });
      await job.files.write('chapter-1.json', new Uint8Array([1]));
      return { fileName: 'book.epub', bytes: new Uint8Array([7, 7]) };
    }`);
    const queued = await context().downloads.enqueue('volume', { book: 1 }, { title: ' Book ', subtitle: 'Vol. 1' });
    // A free slot starts the download before `enqueue` resolves.
    expect(queued).toMatchObject({ kind: 'volume', title: 'Book', subtitle: 'Vol. 1', status: 'running' });

    await until(() => context().downloads.get(queued.id)?.status === 'completed');
    expect(deps.library.importEpub).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'book.epub', bytes: new Uint8Array([7, 7]) }),
    );
    expect(context().downloads.get(queued.id)).toMatchObject({ bookId: 'book-1', attempts: 1, progress: undefined });
    await host.downloads.flush();
    expect(downloads.files.data.has(queued.id)).toBe(false);
    expect(downloads.repository.records.get(queued.id)).toMatchObject({ status: 'completed', bookId: 'book-1' });
    expect(deps.ui.toast).not.toHaveBeenCalledWith(expect.anything(), 'danger');
  });

  it('retries a failed run from its checkpoint and files', async () => {
    const { host } = await start(`async (job) => {
      globalThis.__attempts.push({ attempt: job.attempt, checkpoint: job.checkpoint, has: await job.files.has('a.bin') });
      if (job.attempt === 1) {
        await job.files.write('a.bin', new Uint8Array([1]));
        await job.saveCheckpoint({ done: ['a'] });
        throw new Error('flaky source');
      }
      return { fileName: 'book.epub', bytes: new Uint8Array([1]) };
    }`);
    const { id } = await context().downloads.enqueue('volume', null, { title: 'Book' });

    await until(() => host.downloads.get(id)?.status === 'queued' && host.downloads.get(id)?.attempts === 1);
    expect(host.downloads.get(id)).toMatchObject({ error: 'flaky source', retries: 1 });
    await vi.advanceTimersByTimeAsync(DOWNLOAD_LIMITS.retryDelaysMs[0]);
    await until(() => host.downloads.get(id)?.status === 'completed');
    expect(state.__attempts).toEqual([
      { attempt: 1, checkpoint: undefined, has: false },
      { attempt: 2, checkpoint: { done: ['a'] }, has: true },
    ]);
  });

  it('fails at once on errors marked not retryable, and runs again on resume', async () => {
    const { host, deps } = await start(`async (job) => {
      if (job.attempt === 1) throw Object.assign(new Error('book removed'), { retryable: false });
      return { fileName: 'book.epub', bytes: new Uint8Array([1]) };
    }`);
    const { id } = await context().downloads.enqueue('volume', null, { title: 'Book' });
    await until(() => host.downloads.get(id)?.status === 'failed');
    expect(deps.ui.toast).not.toHaveBeenCalled();
    expect(context().downloads.get(id)).toMatchObject({ error: 'book removed', attempts: 1 });

    context().downloads.resume(id);
    await until(() => host.downloads.get(id)?.status === 'completed');
    expect(host.downloads.get(id)).toMatchObject({ attempts: 2, error: undefined });
  });

  it('stops a paused run and does not let it write afterwards', async () => {
    const { host } = await start(`(job) => new Promise((resolve, reject) => {
      globalThis.__job = job;
      job.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })`);
    const { id } = await context().downloads.enqueue('volume', null, { title: 'Book' });
    await until(() => host.downloads.get(id)?.status === 'running');
    const job = (globalThis as { __job?: import('@umbrae-labs/lunar-plugin-sdk').DownloadJob }).__job!;

    context().downloads.pause(id);
    expect(job.signal.aborted).toBe(true);
    expect(host.downloads.get(id)).toMatchObject({ status: 'paused', pauseReason: 'user' });
    await expect(job.saveCheckpoint({ late: true })).rejects.toMatchObject({ code: 'CANCELLED' });
    await vi.advanceTimersByTimeAsync(100);
    expect(host.downloads.get(id)?.status).toBe('paused');
    expect(host.downloads.get(id)?.checkpoint).toBeUndefined();
  });

  it('brings downloads that were running when the app closed back paused', async () => {
    const shared = memoryDownloads();
    const first = await start('() => new Promise(() => {})', { downloads: shared });
    const { id } = await context().downloads.enqueue('volume', null, { title: 'Book' });
    await until(() => first.host.downloads.get(id)?.status === 'running');
    await first.host.downloads.flush();

    const { host } = createTestHost({ downloads: { ...shared, sha256: async () => '' } });
    await host.downloads.ready();
    expect(host.downloads.getSnapshot()).toEqual([
      expect.objectContaining({ id, pluginId: PLUGIN_ID, status: 'paused', pauseReason: 'interrupted' }),
    ]);
  });

  it('runs a download again under the next instance when the plugin stops', async () => {
    const { host } = await start(`(job) => {
      globalThis.__runs += 1;
      if (globalThis.__runs === 1) return new Promise(() => {});
      return Promise.resolve({ fileName: 'book.epub', bytes: new Uint8Array([1]) });
    }`);
    const { id } = await context().downloads.enqueue('volume', null, { title: 'Book' });
    await until(() => host.downloads.get(id)?.status === 'running');

    await host.deactivate(PLUGIN_ID);
    expect(host.downloads.get(id)?.status).toBe('queued');
    await until(() => host.downloads.get(id)?.status === 'completed');
    expect(state.__runs).toBe(2);
    expect(host.getStatuses()[0].generation).toBe(2);
  });

  it('returns the unfinished download that has the same key', async () => {
    await start('() => new Promise(() => {})');
    const first = await context().downloads.enqueue('volume', { n: 1 }, { title: 'Book', key: 'book-1' });
    const second = await context().downloads.enqueue('volume', { n: 2 }, { title: 'Book', key: 'book-1' });
    expect(second.id).toBe(first.id);
    expect(context().downloads.list()).toHaveLength(1);
  });

  it('checks declarations, permissions and parameters', async () => {
    await start('() => new Promise(() => {})', { permissions: ['library.import'] });
    const downloads = context().downloads;
    await expect(downloads.enqueue('chapter', null, { title: 'Book' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(downloads.enqueue('volume', null, { title: '' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(
      downloads.enqueue('volume', 'x'.repeat(DOWNLOAD_LIMITS.paramsBytes), { title: 'Book' }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    await expect(
      downloads.enqueueFile({ url: 'https://example.com/a.epub', fileName: 'a.epub', title: 'A' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('fetches files itself and verifies their size and checksum', async () => {
    const { host, deps } = await start('() => new Promise(() => {})');
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(deps.network.download).mockImplementation(async (_plugin, _request, _signal, _headers, onProgress) => {
      onProgress(3, 3);
      return bytes;
    });
    const good = await context().downloads.enqueueFile({
      url: 'https://example.com/a.epub',
      fileName: 'a.epub',
      title: 'A',
      sha256: sha256(bytes),
      size: 3,
    });
    expect(good.kind).toBe('lunar.file');
    await until(() => host.downloads.get(good.id)?.status === 'completed');
    expect(deps.network.download).toHaveBeenCalledWith(
      PLUGIN_ID,
      expect.objectContaining({ url: 'https://example.com/a.epub' }),
      expect.any(AbortSignal),
      undefined,
      expect.any(Function),
    );

    const bad = await context().downloads.enqueueFile({
      url: 'https://example.com/b.epub',
      fileName: 'b.epub',
      title: 'B',
      sha256: '0'.repeat(64),
    });
    for (const delay of DOWNLOAD_LIMITS.retryDelaysMs) {
      await until(() => host.downloads.get(bad.id)?.status !== 'running');
      await vi.advanceTimersByTimeAsync(delay);
    }
    await until(() => host.downloads.get(bad.id)?.status === 'failed');
    expect(host.downloads.get(bad.id)).toMatchObject({
      attempts: DOWNLOAD_LIMITS.retryDelaysMs.length + 1,
      error: 'INTEGRITY_FAILED: The file does not match its SHA-256 checksum',
    });
    expect(deps.ui.toast).not.toHaveBeenCalled();
  });

  it('pauses downloads of a plugin that was turned off', async () => {
    const { host } = await start('() => new Promise(() => {})');
    const { id } = await context().downloads.enqueue('volume', null, { title: 'Book' });
    await until(() => host.downloads.get(id)?.status === 'running');
    host.setPlugins([
      { plugin: plugin(entry('() => {}'), { manifest: downloadManifest() }), enabled: false },
    ]);
    await until(() => host.downloads.get(id)?.status === 'paused');
    expect(host.downloads.get(id)?.pauseReason).toBe('disabled');
  });

  it('validates coverUrl, keeps host coverUri after import, and does not leak coverUri to plugins', async () => {
    const { host, deps } = await start(`async () => ({ fileName: 'book.epub', bytes: new Uint8Array([1]) })`);
    deps.library.importEpub.mockResolvedValue({
      id: 'book-cover',
      title: 'Book',
      author: 'Author',
      language: 'zh-CN',
      coverUri: 'file:///books/book-cover/cover.jpg',
    });
    await expect(
      context().downloads.enqueue('volume', null, { title: 'Bad', coverUrl: 'http://127.0.0.1/cover.jpg' }),
    ).rejects.toMatchObject({ code: 'NETWORK_DENIED' });

    const queued = await context().downloads.enqueue('volume', null, {
      title: 'With Cover',
      coverUrl: 'https://img.example.com/cover.jpg',
    });
    expect(queued.coverUrl).toBe('https://img.example.com/cover.jpg');

    await until(() => host.downloads.get(queued.id)?.status === 'completed');
    const hostItem = host.downloads.getSnapshot().find((item) => item.id === queued.id);
    expect(hostItem).toMatchObject({
      coverUrl: 'https://img.example.com/cover.jpg',
      coverUri: 'file:///books/book-cover/cover.jpg',
    });
    const pluginItem = context().downloads.get(queued.id);
    expect(pluginItem?.coverUrl).toBe('https://img.example.com/cover.jpg');
    expect('coverUri' in (pluginItem ?? {})).toBe(false);
  });
});
