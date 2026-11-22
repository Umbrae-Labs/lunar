import { describe, expect, it, vi } from 'vitest';

import { PLUGIN_HOST_LIMITS } from '../../src/features/plugins/services/plugin-host';
import { createTestHost, flush, manifest, plugin } from './plugin-test-support';

const entry = (body: string) => `exports.default = { ${body} };`;

describe('plugin host lifecycle', () => {
  it('commits registrations only after activate() resolves', async () => {
    const { host } = createTestHost();
    host.setPlugins([
      {
        plugin: plugin(
          entry(`async activate(ctx) {
            ctx.commands.register('run', () => { globalThis.__ran = (globalThis.__ran ?? 0) + 1; });
            ctx.ui.registerSlot('reader.panel', 'panel', function Panel() { return null; });
          }`),
        ),
        enabled: true,
      },
    ]);
    expect(await host.ensureActive('org.example.test')).toBe(true);
    expect(host.getStatuses()[0]).toMatchObject({ state: 'active', generation: 1 });
    expect(host.getComponent('org.example.test', 'reader.panel:panel')).toBeTypeOf('function');
    await host.executeCommand('org.example.test', 'run', 'toolbar');
    expect((globalThis as { __ran?: number }).__ran).toBe(1);
  });

  it('rolls back every registration when activation fails and reports the error', async () => {
    const { host, deps } = createTestHost();
    host.setPlugins([
      {
        plugin: plugin(
          entry(`activate(ctx) {
            ctx.ui.registerSlot('reader.panel', 'panel', function Panel() { return null; });
            throw new Error('boom');
          }`),
        ),
        enabled: true,
      },
    ]);
    expect(await host.ensureActive('org.example.test')).toBe(false);
    expect(host.getStatuses()[0]).toMatchObject({ state: 'failed', error: 'boom' });
    expect(host.getComponent('org.example.test', 'reader.panel:panel')).toBeUndefined();
    expect(deps.markActivation).toHaveBeenLastCalledWith(undefined);
  });

  it('refuses ids that the manifest does not declare', async () => {
    const { host } = createTestHost();
    host.setPlugins([
      { plugin: plugin(entry(`activate(ctx) { ctx.commands.register('secret', () => {}); }`)), enabled: true },
    ]);
    expect(await host.ensureActive('org.example.test')).toBe(false);
    expect(host.getStatuses()[0].error).toContain('"secret" is not declared');
  });

  it('times out an activation that never settles', async () => {
    vi.useFakeTimers();
    const { host } = createTestHost();
    host.setPlugins([{ plugin: plugin(entry('activate() { return new Promise(() => {}); }')), enabled: true }]);
    const activation = host.ensureActive('org.example.test');
    await vi.advanceTimersByTimeAsync(PLUGIN_HOST_LIMITS.activationTimeoutMs + 1);
    expect(await activation).toBe(false);
    expect(host.getStatuses()[0].error).toContain('TIMEOUT');
    vi.useRealTimers();
  });

  it('shares one activation between concurrent callers and skips disabled plugins', async () => {
    const { host } = createTestHost();
    host.setPlugins([
      { plugin: plugin(entry('activate() {}')), enabled: true },
      {
        plugin: plugin(entry('activate() {}'), {
          id: 'org.example.off',
          manifest: manifest({ id: 'org.example.off' }),
        }),
        enabled: false,
      },
    ]);
    const [first, second] = await Promise.all([
      host.ensureActive('org.example.test'),
      host.ensureActive('org.example.test'),
    ]);
    expect([first, second]).toEqual([true, true]);
    expect(host.getStatuses().find((status) => status.plugin.id === 'org.example.test')?.generation).toBe(1);
    expect(await host.ensureActive('org.example.off')).toBe(false);
  });

  it('disposes subscriptions and ends the generation when the plugin is disabled', async () => {
    const { host } = createTestHost();
    const disposed = vi.fn();
    (globalThis as { __disposed?: unknown }).__disposed = disposed;
    host.setPlugins([
      {
        plugin: plugin(
          entry(`activate(ctx) {
            globalThis.__ctx = ctx;
            ctx.subscriptions.push({ dispose: globalThis.__disposed });
          }`),
        ),
        enabled: true,
      },
    ]);
    await host.ensureActive('org.example.test');
    const ctx = (globalThis as { __ctx?: { commands: { register(id: string, run: () => void): void } } }).__ctx!;
    host.setPlugins([{ plugin: host.getStatuses()[0].plugin, enabled: false }]);
    await flush();
    expect(disposed).toHaveBeenCalledOnce();
    expect(() => ctx.commands.register('run', () => undefined)).toThrow('has been stopped');
  });

  it('reloads development builds and defers installed updates to a restart', async () => {
    const { host } = createTestHost();
    const development = plugin(entry('activate() {}'), { source: 'development' });
    host.setPlugins([{ plugin: development, enabled: true }]);
    await host.ensureActive(development.id);
    host.setPlugins([{ plugin: { ...development, inlineEntry: entry('activate() {} ') }, enabled: true }]);
    await flush();
    await flush();
    expect(host.getStatuses()[0]).toMatchObject({ state: 'active', generation: 2 });

    const installed = plugin(entry('activate() {}'), {
      id: 'org.example.app',
      manifest: manifest({ id: 'org.example.app' }),
    });
    host.setPlugins([{ plugin: installed, enabled: true }]);
    await host.ensureActive(installed.id);
    host.setPlugins([
      {
        plugin: { ...installed, version: '1.1.0', manifest: manifest({ id: 'org.example.app', version: '1.1.0' }) },
        enabled: true,
      },
    ]);
    expect(host.getStatuses()[0]).toMatchObject({ pendingVersion: '1.1.0' });
    expect(host.getStatuses()[0].plugin.version).toBe('1.0.0');
  });

  it('disables a plugin after repeated crashes', async () => {
    const { host, deps } = createTestHost();
    host.setPlugins([{ plugin: plugin(entry('activate() {}')), enabled: true }]);
    await host.ensureActive('org.example.test');
    for (let index = 0; index < PLUGIN_HOST_LIMITS.crashesBeforeDisable; index += 1) {
      host.reportCrash('org.example.test', new Error('render failed'), 'reader.panel:panel');
    }
    expect(deps.onAutoDisabled).toHaveBeenCalledWith('org.example.test', expect.stringContaining('Disabled'));
    expect(host.getStatuses()[0].enabled).toBe(false);
  });

  it('batches log notifications after the current task', async () => {
    const { host } = createTestHost();
    host.setPlugins([{ plugin: plugin(entry('activate() {}')), enabled: true }]);
    await host.ensureActive('org.example.test');
    const listener = vi.fn();
    const unsubscribe = host.subscribeLogs(listener);
    const version = host.getLogVersion();
    host.reportCrash('org.example.test', new Error('first'), 'reader.panel:panel');
    host.reportCrash('org.example.test', new Error('second'), 'reader.panel:panel');
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(host.getLogVersion()).toBeGreaterThan(version);
    unsubscribe();
  });

  it('activates plugins that declare an eager event', async () => {
    const { host } = createTestHost();
    host.setPlugins([
      {
        plugin: plugin(entry('activate() {}'), { manifest: manifest({ activationEvents: ['onStartup'] }) }),
        enabled: true,
      },
    ]);
    await host.trigger('onReaderOpen');
    expect(host.getStatuses()[0].state).toBe('idle');
    await host.trigger('onStartup');
    expect(host.getStatuses()[0].state).toBe('active');
  });
});

describe('plugin context services', () => {
  async function activated(body: string) {
    const setup = createTestHost();
    setup.host.setPlugins([
      { plugin: plugin(entry(`activate(ctx) { globalThis.__ctx = ctx; ${body} }`)), enabled: true },
    ]);
    await setup.host.ensureActive('org.example.test');
    return { ...setup, ctx: (globalThis as { __ctx?: any }).__ctx };
  }

  it('validates settings against the manifest and reports changes', async () => {
    const { ctx } = await activated('');
    expect(ctx.settings.get('limit')).toBe(10);
    const changes: unknown[] = [];
    ctx.settings.onChange('limit', (value: unknown) => changes.push(value));
    await ctx.settings.set('limit', 12);
    expect(ctx.settings.get('limit')).toBe(12);
    expect(changes).toEqual([12]);
    await expect(ctx.settings.set('limit', 99)).rejects.toThrow('Invalid value');
    expect(() => ctx.settings.get('unknown')).toThrow('not declared');
  });

  it('stores JSON values per plugin and enforces the value quota', async () => {
    const { ctx, deps } = await activated('');
    await ctx.storage.set('stats', { pages: 3 });
    expect(await ctx.storage.get('stats')).toEqual({ pages: 3 });
    expect(await ctx.storage.keys()).toEqual(['stats']);
    expect([...deps.storage.data.keys()][0]).toBe('org.example.test\u0000stats');
    await expect(ctx.storage.set('big', 'x'.repeat(300 * 1024))).rejects.toThrow('too large');
  });

  it('applies concurrent updates one after another', async () => {
    const { ctx, deps } = await activated('');
    // A slow read would let a plain get-then-set lose one of the two increments.
    const read = deps.storage.get;
    deps.storage.get = async (pluginId, key) => {
      await flush();
      return read(pluginId, key);
    };
    const add = (value: { count: number } | undefined) => ({ count: (value?.count ?? 0) + 1 });
    await Promise.all([ctx.storage.update('total', add), ctx.storage.update('total', add), ctx.storage.set('x', 1)]);
    expect(await ctx.storage.get('total')).toEqual({ count: 2 });
    expect(await ctx.storage.update('total', () => undefined)).toBeUndefined();
    expect(await ctx.storage.keys()).toEqual(['x']);
    await expect(ctx.storage.update('total', async () => ({ count: 1 }))).rejects.toThrow('synchronous');
  });

  it('translates with the host locale and interpolates parameters', async () => {
    const { ctx } = await activated('');
    expect(ctx.i18n.t('name')).toBe('测试');
    expect(ctx.i18n.t('missing {{n}}', { n: 2 })).toBe('missing 2');
    expect(ctx.host.capabilities['reader.chapterText']).toBeUndefined();
  });

  it('requires the network permission before requesting', async () => {
    const { ctx, deps } = await activated('');
    await expect(ctx.network.request({ url: 'https://example.com/' })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(deps.network.request).not.toHaveBeenCalled();
  });

  it('adds a configured credential to requests and reports its status without the key', async () => {
    const setup = createTestHost();
    const withCredential = manifest({
      permissions: [{ name: 'network', reason: 'AI' }],
      contributes: { credentials: [{ id: 'api', title: 'API key', prefix: 'Bearer ' }] },
    });
    setup.host.setPlugins([
      {
        plugin: plugin(entry(`activate(ctx) { globalThis.__ctx = ctx; }`), { manifest: withCredential }),
        enabled: true,
      },
    ]);
    await setup.host.ensureActive('org.example.test');
    const ctx = (globalThis as { __ctx?: any }).__ctx;
    const credentials = setup.deps.credentials;
    const url = 'https://api.example.com/v1/chat/completions';

    expect(ctx.credentials.get('api')).toEqual({ id: 'api', configured: false });
    expect(() => ctx.credentials.get('other')).toThrow('not declared');
    await expect(ctx.network.request({ url, credential: 'api' })).rejects.toMatchObject({
      code: 'CREDENTIAL_REQUIRED',
    });

    const changes: unknown[] = [];
    ctx.credentials.onChange('api', (status: unknown) => changes.push(status));
    credentials.set('org.example.test', 'api', { baseUrl: 'https://api.example.com/v1', updatedAt: 1 }, 'sk-1');
    const status = ctx.credentials.get('api');
    expect(status).toEqual({ id: 'api', configured: true, baseUrl: 'https://api.example.com/v1' });
    expect(ctx.credentials.get('api')).toBe(status);
    expect(changes).toEqual([status]);

    await ctx.network.stream({ url, credential: 'api', onText: () => undefined });
    expect(setup.deps.network.stream).toHaveBeenCalledWith(
      'org.example.test',
      expect.objectContaining({ url }),
      expect.anything(),
      { Authorization: 'Bearer sk-1' },
    );
    await expect(
      ctx.network.request({ url: 'https://elsewhere.example.net/v1', credential: 'api' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(ctx.credentials.configure('api')).resolves.toBe(status);
    expect(setup.deps.ui.configureCredential).toHaveBeenCalledWith('org.example.test', 'api');
  });

  it('requires library.import before accepting EPUB bytes', async () => {
    const { ctx } = await activated('');
    await expect(ctx.library.importEpub({ fileName: 'book.epub', bytes: new Uint8Array() })).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('imports EPUB bytes through the host library bridge', async () => {
    const setup = createTestHost();
    const permitted = manifest({ permissions: [{ name: 'library.import', reason: 'import' }] });
    setup.host.setPlugins([
      { plugin: plugin(entry('activate(ctx) { globalThis.__ctx = ctx; }'), { manifest: permitted }), enabled: true },
    ]);
    await setup.host.ensureActive('org.example.test');
    const ctx = (globalThis as { __ctx?: any }).__ctx;
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(ctx.library.importEpub({ fileName: 'book.epub', bytes })).resolves.toMatchObject({ id: 'book-1' });
    expect(setup.deps.library.importEpub).toHaveBeenCalledWith({ fileName: 'book.epub', bytes });
  });
});
