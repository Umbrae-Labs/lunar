import { describe, expect, it, vi } from 'vitest';

import type { ReaderSessionPort, ReaderSessionState } from '../../src/features/reader';
import { ReaderSessionEventBus } from '../../src/features/reader/services/reader-session-event-bus';
import {
  createTextSegmentKey,
  decodeRangeRef,
  encodeLocatorRef,
  encodeRangeRef,
} from '../../src/features/plugins/domain/plugin-refs';
import { assertRequestAllowed } from '../../src/features/plugins/services/plugin-network';
import { parseDevServerUrl } from '../../src/features/plugins/services/plugin-dev-session';
import { createTestHost, manifest, plugin } from './plugin-test-support';

const location = {
  locator: { spineIdref: 'c1', manifestHref: 'c1.xhtml', chapterProgress: 0.2 },
  chapter: { href: 'c1.xhtml', title: '第一章' },
  progression: 0.1,
  page: 3,
  totalPages: 40,
};

function fakePort() {
  const events = new ReaderSessionEventBus();
  const listeners = new Set<() => void>();
  let state: ReaderSessionState = { lifecycle: 'closed', phase: 'idle', interaction: 'loading', hasSelection: false };
  const port: ReaderSessionPort = {
    events,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getToc: () => [{ label: '第一章', href: 'c1.xhtml', children: [] }],
    getVisibleText: () => ({
      revisionId: 4,
      frameKey: 'frame-1',
      href: 'c1.xhtml',
      segments: [
        {
          text: '第一句。',
          range: { start: { entryIndex: 0, charIndex: 0 }, end: { entryIndex: 0, charIndex: 4 } },
          sourceRange: { start: { nodePath: [0, 1], textOffset: 0 }, end: { nodePath: [0, 1], textOffset: 4 } },
        },
        { text: '无来源。', range: { start: { entryIndex: 1, charIndex: 0 }, end: { entryIndex: 1, charIndex: 4 } } },
      ],
    }),
    search: vi.fn(async () => ({ query: 'x', truncated: false, results: [] }) as never),
    next: vi.fn(async () => true),
    previous: vi.fn(async () => true),
    goToLocator: vi.fn(async () => true),
    goToChapter: vi.fn(async () => true),
    goToProgression: vi.fn(async () => false),
  };
  const setState = (patch: Partial<ReaderSessionState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const open = () => {
    setState({ lifecycle: 'open', phase: 'ready', interaction: 'idle', book: { id: 'book-1', title: '书' }, location });
    events.emit({ type: 'open', bookId: 'book-1' });
    events.emit({ type: 'ready', bookId: 'book-1', location });
  };
  return { port, events, setState, open };
}

async function setup(body: string, patch: Parameters<typeof manifest>[0] = {}) {
  const testHost = createTestHost();
  testHost.host.setPlugins([
    {
      plugin: plugin(`exports.default = { activate(ctx) { globalThis.__ctx = ctx; ${body} } };`, {
        manifest: manifest(patch),
      }),
      enabled: true,
    },
  ]);
  await testHost.host.ensureActive('org.example.test');
  const reader = fakePort();
  const controls = { openPanel: vi.fn(() => true), closePanel: vi.fn() };
  const detach = testHost.host.reader.attach(reader.port, controls);
  return { ...testHost, ...reader, controls, detach, ctx: (globalThis as { __ctx?: any }).__ctx };
}

describe('plugin reader bridge', () => {
  it('converts session events into plugin events with opaque references', async () => {
    const { ctx, open, events } = await setup('');
    const received: [string, unknown][] = [];
    for (const name of ['open', 'ready', 'locationChange', 'close'])
      ctx.reader.on(name, (payload: unknown) => received.push([name, payload]));
    open();
    events.emit({ type: 'locationChange', bookId: 'book-1', location: { ...location, page: 4 } });
    events.emit({ type: 'close', bookId: 'book-1', location });
    expect(received.map(([name]) => name)).toEqual(['open', 'ready', 'locationChange', 'close']);
    expect(received[1][1]).toMatchObject({
      book: { ref: 'book-1', title: '书' },
      location: { chapter: { ref: 'c1.xhtml', title: '第一章' }, progress: 0.1, page: 3, totalPages: 40 },
    });
    expect((received[1][1] as { location: { locator: string } }).location.locator).toMatch(/^ll1:/);
  });

  it('replays the open session to a plugin that activates later', async () => {
    const testHost = createTestHost();
    const reader = fakePort();
    testHost.host.reader.attach(reader.port, { openPanel: () => true, closePanel: () => undefined });
    reader.open();
    testHost.host.setPlugins([
      {
        plugin: plugin(`exports.default = { activate(ctx) {
          globalThis.__seen = [];
          ctx.reader.on('open', () => globalThis.__seen.push('open'));
          ctx.reader.on('ready', () => globalThis.__seen.push('ready'));
        } };`),
        enabled: true,
      },
    ]);
    await testHost.host.ensureActive('org.example.test');
    expect((globalThis as { __seen?: string[] }).__seen).toEqual(['open', 'ready']);
  });

  it('requires the declared permission for each reader capability', async () => {
    const { ctx } = await setup('', { permissions: [] });
    expect(() => ctx.reader.on('open', () => undefined)).toThrow('reader.events');
    await expect(ctx.reader.session.getVisibleText()).rejects.toThrow('reader.content.read');
    expect(() => ctx.reader.decorations.create('marks')).toThrow('reader.decorations');
  });

  it('keys visible text by book and source range, independent of the layout', async () => {
    const { ctx, open } = await setup('');
    open();
    const [placed, unplaced] = await ctx.reader.session.getVisibleText();
    const sourceRange = { start: { nodePath: [0, 1], textOffset: 0 }, end: { nodePath: [0, 1], textOffset: 4 } };
    expect(placed.key).toBe(createTextSegmentKey('book-1', 'c1.xhtml', sourceRange));
    expect(placed.key).toMatch(/^s1\.[0-9a-z]+$/);
    expect(createTextSegmentKey('book-2', 'c1.xhtml', sourceRange)).not.toBe(placed.key);
    expect(
      createTextSegmentKey('book-1', 'c1.xhtml', { ...sourceRange, end: { nodePath: [0, 1], textOffset: 5 } }),
    ).not.toBe(placed.key);
    expect(unplaced.key).toBeUndefined();
  });

  it('returns visible text with ranges that decorations accept, and drops other books', async () => {
    const { ctx, open, host } = await setup('');
    open();
    const [segment] = await ctx.reader.session.getVisibleText();
    expect(segment).toMatchObject({ text: '第一句。', chapterRef: 'c1.xhtml' });
    expect(decodeRangeRef(segment.range)).toMatchObject({ bookId: 'book-1', frameKey: 'frame-1', revisionId: 4 });
    const layer = ctx.reader.decorations.create('marks');
    const foreign = encodeRangeRef({ bookId: 'book-2', text: 'x' });
    layer.set([
      { range: segment.range, style: 'wavy', color: 'accent' },
      { range: foreign, style: 'background', color: 'yellow' },
    ]);
    expect(host.reader.getDecorations()).toEqual([
      expect.objectContaining({ text: '第一句。', style: 'wavy', color: 'accent', href: 'c1.xhtml' }),
    ]);
    expect(() => layer.set([{ range: 'nope', style: 'wavy', color: 'accent' }])).toThrow('invalid range');
    layer.dispose();
    expect(host.reader.getDecorations()).toEqual([]);
  });

  it('clears decorations when the book closes', async () => {
    const { ctx, open, events, host } = await setup('');
    open();
    const [segment] = await ctx.reader.session.getVisibleText();
    ctx.reader.decorations.create('marks').set([{ range: segment.range, style: 'underline', color: 'blue' }]);
    events.emit({ type: 'close', bookId: 'book-1' });
    expect(host.reader.getDecorations()).toEqual([]);
  });

  it('lets interceptors add selection items and grants a frozen snapshot on press', async () => {
    const { ctx, open, host } = await setup(`
      ctx.reader.intercept('selectionMenu', (items) => [
        ...items.filter((item) => item.id !== 'lunar.note'),
        { id: 'define', title: 'Define', onPress: (selection) => { globalThis.__selection = selection; } },
      ]);
    `);
    open();
    const builtin = ['copy', 'note'].map((key) => ({ id: `lunar.${key}`, title: key, builtin: true }));
    const { items, origins } = host.reader.runSelectionMenu(builtin, host.reader.currentBook()!);
    expect(items.map((item) => item.id)).toEqual(['lunar.copy', 'define']);
    const define = items[1];
    expect(origins.get(define)).toBe('org.example.test');
    define.onPress!(
      host.reader.grantSelection('org.example.test', {
        text: '月光',
        href: 'c1.xhtml',
        range: { start: { entryIndex: 0, charIndex: 0 }, end: { entryIndex: 0, charIndex: 2 } },
        revisionId: 4,
      }),
    );
    const snapshot = (globalThis as { __selection?: { selectionRef: string; text: string } }).__selection!;
    expect(snapshot.text).toBe('月光');
    expect(await ctx.reader.session.readSelection(snapshot.selectionRef)).toEqual(snapshot);
    await expect(ctx.reader.session.readSelection('sel:999')).rejects.toThrow('no longer available');
  });

  it('ignores interceptors that replace built-in items', async () => {
    const { open, host } = await setup(`
      ctx.reader.intercept('selectionMenu', (items) => items.map((item) => ({ ...item })));
    `);
    open();
    const builtin = [{ id: 'lunar.copy', title: 'copy', builtin: true }];
    expect(host.reader.runSelectionMenu(builtin, host.reader.currentBook()!).items).toBe(builtin);
  });

  it('navigates through the port and rejects locators from other books', async () => {
    const { ctx, open, port } = await setup('');
    open();
    const locator = encodeLocatorRef({ bookId: 'book-1', locator: location.locator });
    expect(await ctx.reader.session.goTo({ locator })).toBe(true);
    expect(port.goToLocator).toHaveBeenCalledWith(location.locator);
    await expect(
      ctx.reader.session.goTo({ locator: encodeLocatorRef({ bookId: 'other', locator: location.locator }) }),
    ).rejects.toThrow('another book');
    expect(await ctx.reader.session.goTo({ progress: 0.5 })).toBe(false);
  });

  it('opens declared panels through the attached reader', async () => {
    const { ctx, controls } = await setup('');
    ctx.ui.openPanel('panel');
    expect(controls.openPanel).toHaveBeenCalledWith('plugin:org.example.test:panel');
    expect(() => ctx.ui.openPanel('other')).toThrow('not declared');
  });

  it('reports selection changes from the session state', async () => {
    const { ctx, open, setState } = await setup('');
    const changes: boolean[] = [];
    ctx.reader.on('selectionChange', ({ hasSelection }: { hasSelection: boolean }) => changes.push(hasSelection));
    open();
    setState({ hasSelection: true });
    setState({ hasSelection: true });
    setState({ hasSelection: false });
    expect(changes).toEqual([true, false]);
  });

  it('shares the reader controls with plugins until the screen leaves', async () => {
    const { ctx, host, detach } = await setup('');
    const listener = vi.fn();
    host.reader.subscribeChrome(listener);
    expect(ctx.reader.session.chrome()).toBeUndefined();
    const chrome = { controlsVisible: true, insets: { top: 80, right: 0, bottom: 90, left: 0 } };
    host.reader.setChrome(chrome);
    host.reader.setChrome({ ...chrome, insets: { ...chrome.insets } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(ctx.reader.session.chrome()).toEqual(chrome);
    detach();
    expect(ctx.reader.session.chrome()).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps floating entry state per instance and validates it', async () => {
    const { ctx, host } = await setup('', {
      contributes: {
        commands: [{ id: 'run', title: 'Run' }],
        slots: { 'reader.floating': [{ id: 'ball', command: 'run', icon: 'star' }] },
      },
    });
    const version = host.getVersion();
    ctx.ui.setFloating('ball', { badge: '3' });
    expect(host.getVersion()).toBe(version + 1);
    ctx.ui.setFloating('ball', { badge: '3' });
    expect(host.getVersion()).toBe(version + 1);
    expect(host.getEntry('org.example.test')?.generation?.floating.get('ball')).toEqual({
      visible: undefined,
      badge: '3',
    });
    expect(() => ctx.ui.setFloating('other', {})).toThrow('not declared');
    expect(() => ctx.ui.setFloating('ball', { badge: 'too long' })).toThrow('4 characters');
    await host.deactivate('org.example.test');
    expect(host.getEntry('org.example.test')?.generation).toBeUndefined();
  });
});

describe('plugin network policy', () => {
  it('accepts any public HTTPS host', () => {
    expect(assertRequestAllowed({ url: 'https://api.example.com/v1' }).pathname).toBe('/v1');
    expect(assertRequestAllowed({ url: 'https://cdn.other.example/a.jpg' }).hostname).toBe('cdn.other.example');
    expect(() => assertRequestAllowed({ url: 'http://api.example.com/' })).toThrow('Only HTTPS');
    expect(() => assertRequestAllowed({ url: 'https://user:pass@api.example.com/' })).toThrow('credentials');
  });

  it.each([
    'https://127.0.0.1/',
    'https://10.0.0.8/',
    'https://192.168.1.2/',
    'https://[::1]/',
    'https://printer.local/',
  ])('refuses the local address %s', (url) => {
    expect(() => assertRequestAllowed({ url })).toThrow('Local network');
  });
});

describe('plugin development server address', () => {
  it('requires the pairing token printed by the CLI', () => {
    const token = 'a'.repeat(32);
    expect(parseDevServerUrl(`http://192.168.1.2:5757/?token=${token}`)).toMatchObject({ token });
    expect(() => parseDevServerUrl('http://192.168.1.2:5757/')).toThrow('pairing token');
    expect(() => parseDevServerUrl('ftp://host/?token=' + token)).toThrow('http://');
  });
});
