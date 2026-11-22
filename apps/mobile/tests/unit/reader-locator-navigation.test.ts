import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReaderFontRegistry, ReaderLocator, ReaderTextRangeGeometryRequest, ReaderTextRangeRect } from '../../src/reader/contracts';
import type { RitoTextRangeRequest } from '@umbrae-labs/rito-rn';
import type { RitoArtifact, RitoBackgroundAdvance } from '@umbrae-labs/rito-rn';
import type { RitoArtifactRequest } from '@umbrae-labs/rito-rn';
import { DEFAULT_READER_TYPOGRAPHY } from '../../src/reader/typography/defaults';
import { RitoNativePaginationBackend } from '../../src/reader/runtime/pagination/rito-native-pagination-backend';
import { LunarReaderRuntime } from '../../src/reader/runtime/core/native-reader-runtime';
import { READER_PAPER_PALETTES } from '../../src/features/reader/domain/reader-paper-palettes';

const { openSession } = vi.hoisted(() => ({ openSession: vi.fn() }));
vi.mock('@umbrae-labs/rito-rn', () => ({ RitoReaderSession: { open: openSession } }));
vi.mock('../../src/reader/rito/pinned-font', () => ({
  loadBundledLunarFontBytes: async () => new Uint8Array(),
  createLunarRitoPinnedFonts: async () => ({ faces: [], registrations: [], bodyAlias: '' }),
}));
vi.mock('../../src/reader/skia/fonts/font-registry', () => ({
  LunarSkiaFontRegistry: class {
    loadBuiltinFont() {}
    registerFontFace() {}
    registerChromeFontFace() {}
    dispose() {}
  },
}));
vi.mock('../../src/reader/skia/text/text-measurer', () => ({
  LunarSkiaTextMeasurer: class { paragraphs = {}; dispose() {} },
}));
vi.mock('../../src/reader/skia/images/image-decoder', () => ({
  SkiaImageCache: class { async acquire() { return { release() {} }; } clear() {} },
}));
vi.mock('../../src/reader/skia/rendering/picture-compiler', () => ({
  SkiaPictureCompiler: class { compile() { return {}; } dispose() {} clearCache() {} },
}));

afterEach(() => { vi.useRealTimers(); });

function artifact(id: bigint, href: string): RitoArtifact {
  return {
    protocolVersion: 7, capabilityProfileId: 1, sessionId: 1n, requestId: id, revisionId: 1n,
    revisionVersion: 1, artifactId: id, locator: { href, sourcePoint: { nodePath: [1], textOffset: 12n } },
    matchedBy: 'source-point', localPageIndex: 0, localSpreadIndex: 0, localPageIndexes: [0],
    width: 400, height: 800, navigation: { previous: 'available', next: 'available' },
    textProfile: 'platform-string-runs', resources: [], fonts: [],
    displayList: { formatVersion: 4, commandCount: 0, wireBytes: new Uint8Array(), displayList: { formatVersion: 4, ratio: 1, commandCount: 0, commands: [] } },
    pages: [{ pageIndex: 0, width: 400, height: 800 }],
  };
}

const target: ReaderLocator = { spineIdref: 'second', manifestHref: 'second.xhtml', chapterProgress: 0.5,
  sourcePoint: { nodePath: [1], textOffset: 12 } };

async function setup(options: { completed?: boolean; runtime?: boolean; spreadMode?: 'single' | 'double'; fonts?: RitoArtifact['fonts']; fontRegistry?: ReaderFontRegistry } = {}) {
  const source = { ...artifact(1n, 'first.xhtml'),
    fonts: options.fonts ?? [],
    ...(options.completed ? { bookPageIndex: 0, bookPageCount: 100 } : {}) };
  const destination = { ...artifact(2n, 'second.xhtml'), fonts: options.fonts ?? [] };
  const artifacts = new Map([[1n, source], [2n, destination]]);
  let visible = source;
  let nextId = 2n;
  const session = {
    get currentVisibleArtifact() { return visible; },
    get currentVisibleArtifactId() { return visible.artifactId; },
    nextRequestId: 2n,
    readResource: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]) })),
    readPublication: async () => ({ metadata: { title: 'Book', language: 'en', identifier: 'book' }, toc: [],
      spine: [{ idref: 'first', href: 'first.xhtml' }, { idref: 'second', href: 'second.xhtml' }] }),
    getArtifact: (id: bigint) => artifacts.get(id),
    readPage: vi.fn(async (artifactId: bigint, pageIndex: number) => ({ artifactId, pageIndex, hits: [], semantics: [],
      text: artifacts.get(artifactId)!.locator.href, textLength: 1n, textRuns: [] })),
    requestAdjacent: vi.fn(async () => {
      const candidate = { ...destination, artifactId: nextId++, requestId: nextId };
      artifacts.set(candidate.artifactId, candidate);
      return candidate;
    }),
    peekAdjacent: vi.fn(async () => {
      const candidate = { ...destination, artifactId: nextId++, requestId: nextId };
      artifacts.set(candidate.artifactId, candidate);
      return candidate;
    }),
    textRangeGeometry: vi.fn(async (request: RitoTextRangeRequest) => ({
      artifactId: request.artifactId,
      pageIndex: request.pageIndex,
      rects: [{ bounds: { x: Number(request.artifactId) * 10, y: 40, width: 20, height: 18 },
        blockIndex: 0, lineIndex: 0, runIndex: 0, startCharIndex: 0, endCharIndex: 2 }],
    })),
    requestArtifact: vi.fn(async (request: RitoArtifactRequest) => {
      const candidate = { ...destination, artifactId: nextId++, requestId: request.requestId, locator: request.locator };
      artifacts.set(candidate.artifactId, candidate);
      return candidate;
    }),
    adoptForeground: vi.fn(async (request: { candidateArtifactId: bigint }) => { visible = artifacts.get(request.candidateArtifactId)!; }),
    advanceBackground: vi.fn(async (): Promise<RitoBackgroundAdvance> => {
      const candidate = { ...visible, artifactId: nextId++, bookPageIndex: 42, bookPageCount: 100 };
      artifacts.set(candidate.artifactId, candidate);
      return { state: 'reused', intentRequestId: visible.requestId, movesVisibleContent: false,
        replacesArtifactId: visible.artifactId, artifact: candidate };
    }),
    adoptBackground: vi.fn(async (request: { candidateArtifactId: bigint }) => { visible = artifacts.get(request.candidateArtifactId)!; }),
    releaseArtifact: vi.fn(async (id: bigint) => { artifacts.delete(id); }),
    dispose: vi.fn(async () => undefined),
  };
  openSession.mockImplementation(async () => {
    artifacts.set(source.artifactId, source);
    visible = source;
    return { session, artifact: source };
  });
  const backend = new RitoNativePaginationBackend({ initialHref: 'first.xhtml' });
  const layout = { typography: { ...DEFAULT_READER_TYPOGRAPHY, spreadMode: options.spreadMode ?? 'single' }, theme: 'light' as const, viewport: { width: 400, height: 800, pixelRatio: 1 } };
  const request = { ...layout, bookId: 'book', fileUri: 'book.epub' };
  const loadData = vi.fn(async () => new ArrayBuffer(0));
  const runtime = new LunarReaderRuntime(loadData, backend);
  if (options.runtime) {
    const open = vi.spyOn(backend, 'open');
    await runtime.open(request);
    const { publication } = await open.mock.results[0].value;
    return { backend, publication, session, destination, runtime, loadData, layout };
  }
  const { publication } = await backend.open({ request, layout, pinnedFonts: [], fontRegistry: options.fontRegistry,
    data: new ArrayBuffer(0), revisionId: 1, operationId: 1, signal: new AbortController().signal });
  return { backend, publication, session, destination, runtime, loadData, layout };
}

describe('reader text geometry ownership', () => {
  const request: ReaderTextRangeGeometryRequest = {
    pageIndex: 0,
    start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 },
    end: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 2 },
  };

  it('uses the visible artifact when retained turn sources share its chapter-local page index', async () => {
    const { backend, publication, session } = await setup();
    try {
      for (const spreadIndex of [1, 2, 3, 2, 1]) {
        await backend.getFrame(1, spreadIndex);
        const visible = session.currentVisibleArtifact;
        const rects = await publication.resolveTextRangeGeometry!(request);
        expect(session.textRangeGeometry).toHaveBeenLastCalledWith({
          ...request, sessionId: visible.sessionId, artifactId: visible.artifactId,
        });
        expect(rects[0].bounds.x).toBe(Number(visible.artifactId) * 10);
      }
    } finally { await backend.close(); }
  });

  it('rejects a geometry request when a queued turn replaces its visible artifact', async () => {
    const { backend, publication, session } = await setup();
    try {
      const navigation = backend.getFrame(1, 1);
      const geometry = publication.resolveTextRangeGeometry!(request);
      await navigation;
      expect(await geometry).toEqual([]);
      expect(session.textRangeGeometry).not.toHaveBeenCalled();
    } finally { await backend.close(); }
  });

  it('returns no geometry for a page outside the visible artifact', async () => {
    const { backend, publication, session } = await setup();
    try {
      expect(await publication.resolveTextRangeGeometry!({ ...request, pageIndex: 9 })).toEqual([]);
      expect(session.textRangeGeometry).not.toHaveBeenCalled();
    } finally { await backend.close(); }
  });

  it('discards late geometry after navigation replaces a render in the same revision and slot', async () => {
    const { runtime, publication, destination } = await setup({ completed: true, runtime: true });
    destination.displayList = { ...destination.displayList, wireBytes: new Uint8Array([1]) };
    let resolve!: (rects: readonly ReaderTextRangeRect[]) => void;
    vi.spyOn(publication, 'resolveTextRangeGeometry').mockReturnValueOnce(
      new Promise((done) => { resolve = done; }),
    );
    try {
      const owner = runtime.getSnapshot();
      const geometry = runtime.resolveTextRangeGeometry(request);
      await runtime.goToLocator(target);
      expect(runtime.getSnapshot().revisionId).toBe(owner.revisionId);
      expect(runtime.getSnapshot().spreadIndex).toBe(owner.spreadIndex);
      expect(runtime.getSnapshot().renderId).not.toBe(owner.renderId);
      resolve([{ bounds: { x: 10, y: 40, width: 20, height: 18 },
        blockIndex: 0, lineIndex: 0, runIndex: 0, startCharIndex: 0, endCharIndex: 2 }]);
      expect(await geometry).toEqual([]);
    } finally { await runtime.close(); }
  });
});

describe('saved reader location navigation', () => {
  it('waits for native disposal before a runtime close reports idle', async () => {
    const { runtime, session } = await setup({ runtime: true });
    let finishDisposal!: () => void;
    const disposal = new Promise<void>((resolve) => { finishDisposal = resolve; });
    session.dispose.mockImplementationOnce(() => disposal);
    let settled = false;
    const closing = runtime.close().then(() => { settled = true; });
    try {
      await vi.waitFor(() => expect(session.dispose).toHaveBeenCalledTimes(1));
      expect(settled).toBe(false);
      expect(runtime.getSnapshot().phase).toBe('closing');
      finishDisposal();
      await closing;
      expect(runtime.getSnapshot().phase).toBe('idle');
      expect(session.dispose).toHaveBeenCalledTimes(1);
    } finally {
      finishDisposal();
      await closing;
    }
  });

  it('joins a native close already started by cancellation', async () => {
    const { backend, session } = await setup();
    let finishDisposal!: () => void;
    session.dispose.mockImplementationOnce(() => new Promise<void>((resolve) => { finishDisposal = resolve; }));
    const cancelled = backend.cancel(1, 1);
    let settled = false;
    const closing = backend.close().then(() => { settled = true; });
    try {
      await vi.waitFor(() => expect(session.dispose).toHaveBeenCalledTimes(1));
      expect(settled).toBe(false);
      finishDisposal();
      await Promise.all([cancelled, closing]);
      expect(settled).toBe(true);
      expect(session.dispose).toHaveBeenCalledTimes(1);
    } finally {
      finishDisposal();
      await Promise.all([cancelled, closing]);
    }
  });

  it('settles runtime teardown without an unhandled cancellation rejection when disposal fails', async () => {
    const { runtime, session } = await setup({ runtime: true });
    session.dispose.mockRejectedValueOnce(new Error('native disposal failed'));
    await runtime.close();
    expect(runtime.getSnapshot().phase).toBe('idle');
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(['light', 'dark'] as const)('applies all %s paper palettes while keeping the reading position', async (theme) => {
    const { runtime, publication, layout, loadData } = await setup({ completed: true, runtime: true });
    try {
      const locator = runtime.getSnapshot().position?.locator;
      for (const palette of Object.values(READER_PAPER_PALETTES[theme])) {
        const previousRevision = runtime.getSnapshot().revisionId;
        await runtime.updateLayout({ ...layout, theme, palette });
        expect(runtime.getBackgroundColor()).toBe(palette.backgroundColor);
        expect(runtime.getSnapshot().revisionId).toBeGreaterThan(previousRevision);
        expect(runtime.getSnapshot().position?.locator).toEqual(locator);
        expect(publication.layout.palette).toEqual(palette);
      }
      expect(loadData).toHaveBeenCalledTimes(1);
    } finally { await runtime.close(); }
  });

  it('holds background pagination through overlapping animations and resumes once', async () => {
    vi.useFakeTimers();
    const { runtime, session } = await setup({ runtime: true });
    const releaseFirst = runtime.suspendBackgroundPagination();
    const releaseSecond = runtime.suspendBackgroundPagination();
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(session.advanceBackground).not.toHaveBeenCalled();
      releaseFirst();
      releaseFirst();
      await vi.advanceTimersByTimeAsync(100);
      expect(session.advanceBackground).not.toHaveBeenCalled();
      session.advanceBackground.mockResolvedValueOnce({ state: 'complete', movesVisibleContent: false,
        intentRequestId: 1n, replacesArtifactId: 1n });
      releaseSecond();
      await vi.advanceTimersByTimeAsync(32);
      expect(session.advanceBackground).toHaveBeenCalledTimes(1);
      releaseSecond();
      await vi.advanceTimersByTimeAsync(100);
      expect(session.advanceBackground).toHaveBeenCalledTimes(1);
    } finally { releaseFirst(); releaseSecond(); await runtime.close(); }
  });

  it('reads a font once across navigation and metadata refreshes, and reloads changed content', async () => {
    const font = { family: 'Body', href: 'body.ttf', weight: 400, style: 'normal',
      shapeFingerprint: 'first', byteLength: 3n, features: [] };
    const loadFont = vi.fn(async () => undefined);
    const { backend, publication, session, destination } = await setup({ fonts: [font], fontRegistry: { loadFont } });
    try {
      await backend.advanceBackground();
      await publication.resolveLocator!(target);
      await publication.resolveLocator!(target);
      expect(session.readResource).toHaveBeenCalledTimes(1);
      expect(loadFont).toHaveBeenCalledTimes(1);
      destination.fonts = [{ ...font, shapeFingerprint: 'changed' }];
      await publication.resolveLocator!(target);
      expect(session.readResource).toHaveBeenCalledTimes(2);
      expect(loadFont).toHaveBeenLastCalledWith(expect.objectContaining({ fingerprint: 'changed' }));
    } finally { await backend.close(); }
  });

  it('leaves pinned host faces to their pre-open registration instead of reading them back', async () => {
    const sha = 'a'.repeat(64);
    const hostFont = { family: `__RitoPinned_${sha}`, href: `rito-host-font:${sha}`, weight: 400, style: 'normal',
      shapeFingerprint: 'host', byteLength: 25_575_676n, features: [] };
    const loadFont = vi.fn(async () => undefined);
    const { backend, publication, session } = await setup({ fonts: [hostFont], fontRegistry: { loadFont } });
    try {
      await publication.resolveLocator!(target);
      expect(session.readResource).not.toHaveBeenCalled();
      expect(loadFont).not.toHaveBeenCalled();
    } finally { await backend.close(); }
  });

  it('registers vertical forms of a pinned host face on its pre-open registration', async () => {
    const sha = 'a'.repeat(64);
    const vertical = { family: `__RitoVert___RitoPinned_${sha}`, href: `rito-host-font:${sha}`, weight: 400,
      style: 'normal', shapeFingerprint: 'host', byteLength: 25_575_676n, features: [{ tag: 'vert', value: 1 }] };
    const loadFont = vi.fn(async () => undefined);
    const registerFontVariant = vi.fn(() => true);
    const { backend, publication, session } = await setup({ fonts: [vertical], fontRegistry: { loadFont, registerFontVariant } });
    try {
      await publication.resolveLocator!(target);
      expect(registerFontVariant).toHaveBeenCalledWith(vertical.family, `__RitoPinned_${sha}`, vertical.features);
      expect(session.readResource).not.toHaveBeenCalled();
      expect(loadFont).not.toHaveBeenCalled();
    } finally { await backend.close(); }
  });

  it('reads a publication feature face back when its base face is not registered yet', async () => {
    const vertical = { family: '__RitoHWID_Body', href: 'body.ttf', weight: 400, style: 'normal',
      shapeFingerprint: 'first', byteLength: 3n, features: [{ tag: 'hwid', value: 1 }] };
    const loadFont = vi.fn(async () => undefined);
    const registerFontVariant = vi.fn(() => false);
    const { backend, publication, session } = await setup({ fonts: [vertical], fontRegistry: { loadFont, registerFontVariant } });
    try {
      await publication.resolveLocator!(target);
      expect(registerFontVariant).toHaveBeenCalledWith('__RitoHWID_Body', 'Body', vertical.features);
      expect(session.readResource).toHaveBeenCalledTimes(1);
      expect(loadFont).toHaveBeenCalledWith(expect.objectContaining({ family: '__RitoHWID_Body', features: vertical.features }));
    } finally { await backend.close(); }
  });

  it('retries a font registration that failed on a candidate page', async () => {
    const loadFont = vi.fn(async () => undefined);
    const { backend, publication, session, destination } = await setup({ fontRegistry: { loadFont } });
    destination.fonts = [{ family: 'Body', href: 'body.ttf', weight: 400, style: 'normal',
      shapeFingerprint: 'first', byteLength: 3n, features: [] }];
    loadFont.mockRejectedValueOnce(new Error('font unavailable'));
    try {
      await expect(publication.resolveLocator!(target)).rejects.toThrow('font unavailable');
      await publication.resolveLocator!(target);
      expect(session.readResource).toHaveBeenCalledTimes(2);
      expect(loadFont).toHaveBeenCalledTimes(2);
    } finally { await backend.close(); }
  });

  it('publishes whole-book page numbers after indexing a page budget at a time', async () => {
    vi.useFakeTimers();
    const { runtime, backend, session } = await setup({ runtime: true });
    const advance = vi.spyOn(backend, 'advanceBackground');
    session.advanceBackground.mockResolvedValueOnce({ state: 'indexing', movesVisibleContent: false,
      intentRequestId: 1n, replacesArtifactId: 1n });
    try {
      expect(runtime.getSnapshot().totalSpreads).toBeUndefined();
      await vi.advanceTimersByTimeAsync(32);
      expect(runtime.getSnapshot()).toMatchObject({ phase: 'ready', paginationComplete: false });
      expect(runtime.getSnapshot().totalSpreads).toBeUndefined();
      expect(session.adoptBackground).not.toHaveBeenCalled();
      expect(session.advanceBackground).toHaveBeenNthCalledWith(1, {
        sessionId: 1n, expectedVisibleArtifactId: 1n, maxPagesPerQuantum: 8,
      });

      await vi.advanceTimersByTimeAsync(32);
      expect(runtime.getSnapshot()).toMatchObject({ phase: 'ready', totalSpreads: 100, bookSpreadIndex: 42 });
      expect(session.adoptBackground).toHaveBeenCalledTimes(1);
      session.advanceBackground.mockResolvedValueOnce({ state: 'complete', movesVisibleContent: false,
        intentRequestId: 1n, replacesArtifactId: 2n });

      await vi.advanceTimersByTimeAsync(32);
      expect(session.advanceBackground).toHaveBeenNthCalledWith(3, {
        sessionId: 1n, expectedVisibleArtifactId: 2n, maxPagesPerQuantum: 8,
      });
      expect(runtime.getSnapshot().paginationComplete).toBe(true);
      await vi.advanceTimersByTimeAsync(96);
      expect(advance.mock.calls).toEqual([[], [], []]);
    } finally { await runtime.close(); }
  });

  it('reflows a ready book without rereading bytes or opening another native session', async () => {
    const { runtime, session, loadData, layout } = await setup({ completed: true, runtime: true });
    const opens = openSession.mock.calls.length;
    const initial = runtime.getSnapshot();
    try {
      expect(loadData).toHaveBeenCalledTimes(1);
      await runtime.updateLayout({ ...layout, typography: { ...layout.typography, fontSize: 24 } });
      expect(loadData).toHaveBeenCalledTimes(1);
      expect(openSession).toHaveBeenCalledTimes(opens);
      expect(session.dispose).not.toHaveBeenCalled();
      expect(session.requestArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
        sessionId: 1n,
        layout: expect.objectContaining({ rootFontSize: 24 }),
        locator: expect.objectContaining({ href: 'first.xhtml' }),
      }));
      expect(runtime.getSnapshot()).toMatchObject({ phase: 'ready', revisionId: initial.revisionId + 1 });
      expect(runtime.getSnapshot().renderId).not.toBe(initial.renderId);
    } finally {
      await runtime.close();
    }
  });

  it('keeps the native session when chrome font changes before a layout reflow', async () => {
    const { runtime, loadData, layout } = await setup({ runtime: true });
    const chromeFace = { family: 'SystemSans', source: 'system' as const };
    try {
      runtime.setChromeFontFace(chromeFace);
      await runtime.updateLayout({
        ...layout,
        typography: {
          ...layout.typography,
          fontSize: 22,
          fonts: { ...layout.typography.fonts, chrome: { source: 'system', family: 'SystemSans' } },
        },
        fontFaces: {
          body: { family: layout.typography.fonts.body.family, source: 'builtin' },
          chrome: chromeFace,
        },
      });
      expect(loadData).toHaveBeenCalledTimes(1);
    } finally { await runtime.close(); }
  });

  it('reopens the source when the selected body font changes', async () => {
    const { runtime, loadData, layout } = await setup({ runtime: true });
    try {
      await runtime.updateLayout({
        ...layout,
        typography: {
          ...layout.typography,
          fonts: { ...layout.typography.fonts, body: { source: 'imported', family: 'Replacement', importedFontId: 'new' } },
        },
      });
      expect(loadData).toHaveBeenCalledTimes(2);
    } finally { await runtime.close(); }
  });

  it('reuses copied resolved body faces with the same digest and reopens changed font bytes', async () => {
    const { runtime, loadData, layout } = await setup({ runtime: true });
    const choice = { source: 'imported' as const, family: 'Custom', importedFontId: 'same' };
    const custom = {
      ...layout,
      typography: { ...layout.typography, fonts: { ...layout.typography.fonts, body: choice } },
      fontFaces: {
        body: { family: 'Custom', source: 'imported' as const, bytes: new Uint8Array([1]), sha256: 'a'.repeat(64) },
        chrome: { family: 'LunarWenKai', source: 'builtin' as const },
      },
    };
    try {
      await runtime.updateLayout(custom);
      expect(loadData).toHaveBeenCalledTimes(2);
      await runtime.updateLayout({
        ...custom,
        typography: { ...custom.typography, fontSize: 22 },
        fontFaces: { ...custom.fontFaces, body: { ...custom.fontFaces.body, bytes: new Uint8Array([1]) } },
      });
      expect(loadData).toHaveBeenCalledTimes(2);
      await runtime.updateLayout({
        ...custom,
        fontFaces: { ...custom.fontFaces, body: { ...custom.fontFaces.body, bytes: new Uint8Array([2]), sha256: 'b'.repeat(64) } },
      });
      expect(loadData).toHaveBeenCalledTimes(3);
    } finally { await runtime.close(); }
  });

  it('switches between paged and scrolled modes on the same native session', async () => {
    const { runtime, loadData, session, layout } = await setup({ runtime: true });
    try {
      await runtime.updateLayout({ ...layout, typography: { ...layout.typography, spreadMode: 'scrolled' } });
      expect(loadData).toHaveBeenCalledTimes(1);
      expect(runtime.getCurrentFrame()?.scrollWindow).toEqual({ length: 800, targetOffset: undefined });
      expect(session.requestArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
        layout: expect.objectContaining({ spreadMode: 'scrolled' }),
      }));

      await runtime.updateLayout({ ...layout, typography: { ...layout.typography, spreadMode: 'single' } });
      expect(loadData).toHaveBeenCalledTimes(1);
      expect(runtime.getCurrentFrame()?.scrollWindow).toBeUndefined();
      expect(session.requestArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
        layout: expect.objectContaining({ spreadMode: 'single' }),
      }));
    } finally { await runtime.close(); }
  });

  it('releases non-visible retained artifacts before requesting a reflow candidate', async () => {
    const { runtime, session, layout } = await setup({ runtime: true });
    try {
      await runtime.next();
      const visibleBeforeReflow = session.currentVisibleArtifactId;
      const order: string[] = [];
      const origRelease = session.releaseArtifact.getMockImplementation()!;
      const origRequest = session.requestArtifact.getMockImplementation()!;
      session.releaseArtifact.mockImplementation(async (id: bigint) => {
        order.push(`release:${id.toString()}`);
        return origRelease(id);
      });
      session.requestArtifact.mockImplementation(async (req: RitoArtifactRequest) => {
        order.push('requestArtifact');
        return origRequest(req);
      });

      await runtime.updateLayout({ ...layout, typography: { ...layout.typography, fontSize: 22 } });
      const requestIndex = order.indexOf('requestArtifact');
      expect(requestIndex).toBeGreaterThan(0);
      expect(order.slice(0, requestIndex)).toContain('release:1');
      expect(order.slice(0, requestIndex)).not.toContain(`release:${visibleBeforeReflow.toString()}`);
      expect(order.slice(requestIndex + 1)).toContain(`release:${visibleBeforeReflow.toString()}`);
    } finally { await runtime.close(); }
  });

  it('keeps the visible frame when a reflow candidate cannot be adopted', async () => {
    const { backend, publication, session, layout } = await setup();
    const source = publication.getFrame(0);
    session.adoptForeground.mockRejectedValueOnce(new Error('handoff failed'));
    try {
      await expect(backend.reflow({
        request: { ...layout, bookId: 'book', fileUri: 'book.epub' },
        layout,
        revisionId: 2,
        operationId: 2,
        signal: new AbortController().signal,
      })).rejects.toThrow('handoff failed');
      expect(publication.getFrame(0)).toBe(source);
      expect(session.currentVisibleArtifact.artifactId).toBe(1n);
      expect(session.releaseArtifact).toHaveBeenCalledWith(2n);
      expect(await backend.getFrame(1, 0)).toBe(source);
    } finally { await backend.close(); }
  });

  it('coalesces overlapping layout reflows on the same native session', async () => {
    const { runtime, session, loadData, layout } = await setup({ runtime: true });
    const opens = openSession.mock.calls.length;
    let releaseFirst!: () => void;
    const origRequest = session.requestArtifact.getMockImplementation()!;
    session.requestArtifact.mockImplementationOnce(async (req: RitoArtifactRequest) => {
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return origRequest(req);
    });
    try {
      const first = runtime.updateLayout({ ...layout, typography: { ...layout.typography, fontSize: 20 } });
      await vi.waitFor(() => expect(releaseFirst).toBeDefined());
      const second = runtime.updateLayout({ ...layout, typography: { ...layout.typography, fontSize: 24 } });
      releaseFirst();
      await expect(first).rejects.toMatchObject({ name: 'AbortError' });
      const snapshot = await second;
      expect(snapshot.phase).toBe('ready');
      expect(loadData).toHaveBeenCalledTimes(1);
      expect(openSession).toHaveBeenCalledTimes(opens);
      expect(session.dispose).not.toHaveBeenCalled();
      expect(session.releaseArtifact).toHaveBeenCalledWith(2n);
      expect(session.requestArtifact).toHaveBeenLastCalledWith(expect.objectContaining({
        layout: expect.objectContaining({ rootFontSize: 24 }),
      }));
    } finally { await runtime.close(); }
  });

  it('keeps the session coherent when a second reflow supersedes one mid-adoption', async () => {
    const { runtime, session, loadData, layout } = await setup({ runtime: true });
    let finishFirstAdopt!: () => void;
    const origAdopt = session.adoptForeground.getMockImplementation()!;
    session.adoptForeground.mockImplementationOnce(async (req: { candidateArtifactId: bigint }) => {
      await new Promise<void>((resolve) => { finishFirstAdopt = resolve; });
      return origAdopt(req);
    });
    try {
      const first = runtime.updateLayout({ ...layout, typography: { ...layout.typography, fontSize: 20 } });
      await vi.waitFor(() => expect(finishFirstAdopt).toBeDefined());
      const second = runtime.updateLayout({ ...layout, typography: { ...layout.typography, fontSize: 26 } });
      finishFirstAdopt();
      await expect(first).rejects.toMatchObject({ name: 'AbortError' });
      const snapshot = await second;
      expect(snapshot.phase).toBe('ready');
      expect(loadData).toHaveBeenCalledTimes(1);
      expect(session.dispose).not.toHaveBeenCalled();
      expect(session.adoptForeground).toHaveBeenLastCalledWith(expect.objectContaining({
        expectedVisibleArtifactId: 2n,
        candidateArtifactId: 3n,
      }));
    } finally { await runtime.close(); }
  });

  it('waits for an in-flight peek to end and still reuses the native session for reflow', async () => {
    const { runtime, session, loadData, layout } = await setup({ runtime: true });
    let finishPeek!: () => void;
    const origPeek = session.peekAdjacent.getMockImplementation()!;
    session.peekAdjacent.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { finishPeek = resolve; });
      return origPeek();
    });
    try {
      const initial = runtime.getSnapshot();
      const peek = runtime.peekAdjacentPages(initial.revisionId, initial.spreadIndex, 'next', 1);
      await vi.waitFor(() => expect(finishPeek).toBeDefined());
      const reflow = runtime.updateLayout({ ...layout, typography: { ...layout.typography, fontSize: 24 } });
      finishPeek();
      await peek;
      const snapshot = await reflow;
      expect(snapshot.phase).toBe('ready');
      expect(loadData).toHaveBeenCalledTimes(1);
      expect(session.dispose).not.toHaveBeenCalled();
    } finally { await runtime.close(); }
  });

  it('reopens cleanly after a failed reflow', async () => {
    const { runtime, session, loadData, layout } = await setup({ runtime: true });
    session.requestArtifact.mockRejectedValueOnce(new Error('native reflow failed'));
    try {
      await expect(runtime.updateLayout({ ...layout, typography: { ...layout.typography, fontSize: 22 } }))
        .rejects.toThrow('native reflow failed');
      expect(runtime.getSnapshot().phase).toBe('error');
      const recovered = await runtime.updateLayout({ ...layout, typography: { ...layout.typography, fontSize: 20 } });
      expect(recovered.phase).toBe('ready');
      expect(loadData).toHaveBeenCalledTimes(2);
    } finally { await runtime.close(); }
  });

  it('sends only the start point for a highlight with both saved selectors', async () => {
    const { backend, publication, session } = await setup();
    const range = { start: target.sourcePoint!, end: { nodePath: [2], textOffset: 20 } };
    await publication.resolveLocator!({ ...target, sourceRange: range });
    const [request] = session.requestArtifact.mock.calls[0];
    expect(request.locator.sourcePoint).toEqual({ nodePath: [1], textOffset: 12n });
    expect(request.locator.sourceRange).toBeUndefined();
    await backend.close();
  });

  it.each(['toc', 'bookmark', 'highlight'] as const)('retains the completed total after a %s jump', async (kind) => {
    const { backend, publication } = await setup({ completed: true });
    if (kind === 'toc') await publication.resolveToc('second.xhtml');
    else await publication.resolveLocator!({ ...target, ...(kind === 'highlight' ? {
      sourceRange: { start: target.sourcePoint!, end: { nodePath: [2], textOffset: 20 } },
    } : {}) });
    expect(publication.totalSpreads).toBe(100);
    expect(publication.getBookPageIndex!(0)).toBeUndefined();
    await backend.close();
  });

  it.each(['single', 'double'] as const)('restores book page numbers after repeated jumps in %s mode', async (spreadMode) => {
    vi.useFakeTimers();
    const { runtime, publication, session } = await setup({ completed: true, runtime: true, spreadMode });
    const total = spreadMode === 'double' ? 50 : 100;
    const bookSpreadIndex = spreadMode === 'double' ? 21 : 42;
    try {
      expect(runtime.getSnapshot()).toMatchObject({ totalSpreads: total, paginationComplete: true });
      for (const navigate of [
        () => runtime.goToToc('second.xhtml'),
        () => runtime.goToLocator(target),
        () => runtime.goToLocator({ ...target, sourceRange: { start: target.sourcePoint!, end: { nodePath: [2], textOffset: 20 } } }),
      ]) {
        const snapshot = await navigate();
        expect(snapshot.paginationComplete).toBe(false);
        expect(snapshot.bookSpreadIndex).toBeUndefined();
        expect(publication.totalSpreads).toBe(total);
        await vi.advanceTimersByTimeAsync(32);
        expect(runtime.getSnapshot()).toMatchObject({ totalSpreads: total, bookSpreadIndex });
        session.advanceBackground.mockResolvedValueOnce({ state: 'complete', movesVisibleContent: false,
          intentRequestId: 2n, replacesArtifactId: 0n });
        await vi.advanceTimersByTimeAsync(32);
        expect(runtime.getSnapshot().paginationComplete).toBe(true);
      }
      expect(session.adoptBackground).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(96);
      expect(session.advanceBackground).toHaveBeenCalledTimes(6);
    } finally { await runtime.close(); }
  });

  it('preserves completed page numbers when a saved-location jump fails', async () => {
    vi.useFakeTimers();
    const { runtime, session } = await setup({ completed: true, runtime: true });
    try {
      const source = runtime.getSnapshot();
      session.adoptForeground.mockRejectedValueOnce(new Error('adoption failed'));
      await expect(runtime.goToLocator(target)).rejects.toThrow('adoption failed');
      expect(runtime.getSnapshot()).toBe(source);
      await vi.advanceTimersByTimeAsync(96);
      expect(session.advanceBackground).not.toHaveBeenCalled();
    } finally { await runtime.close(); }
  });

  it('requests exact source coordinates across chapters and publishes the prepared frame', async () => {
    const { backend, publication, session } = await setup();
    expect(await publication.resolveLocator!(target)).toBe(0);
    expect(session.requestArtifact).toHaveBeenCalledWith(expect.objectContaining({
      locator: expect.objectContaining({ href: 'second.xhtml', sourcePoint: { nodePath: [1], textOffset: 12n } }),
    }));
    expect(publication.getCurrentLocator!(0)?.manifestHref).toBe('second.xhtml');
    expect(publication.getFrame(0)?.text).toBe('second.xhtml');
    expect(session.releaseArtifact).toHaveBeenCalledWith(1n);
    await backend.close();
  });

  it('keeps the visible source frame until candidate adoption succeeds', async () => {
    const { backend, publication, session } = await setup();
    const adopt = session.adoptForeground.getMockImplementation()!;
    session.adoptForeground.mockImplementationOnce(async (request) => {
      expect(publication.getFrame(0)?.text).toBe('first.xhtml');
      expect(publication.getCurrentLocator!(0)?.manifestHref).toBe('first.xhtml');
      await adopt(request);
    });
    await publication.resolveLocator!(target);
    expect(publication.getFrame(0)?.text).toBe('second.xhtml');
    await backend.close();
  });

  it('restores the source slot and releases the candidate after failed adoption', async () => {
    const { backend, publication, session } = await setup();
    session.adoptForeground.mockRejectedValueOnce(new Error('adoption failed'));
    await expect(publication.resolveLocator!(target)).rejects.toThrow('adoption failed');
    expect(publication.getFrame(0)?.text).toBe('first.xhtml');
    expect(publication.getCurrentLocator!(0)?.manifestHref).toBe('first.xhtml');
    expect(session.releaseArtifact).toHaveBeenCalledWith(2n);
    expect(session.releaseArtifact).not.toHaveBeenCalledWith(1n);
    await backend.close();
  });

  it('leaves the page intact when the saved chapter is missing', async () => {
    const { backend, publication, session } = await setup();
    expect(await publication.resolveLocator!({ ...target, manifestHref: 'missing.xhtml' })).toBeUndefined();
    expect(session.requestArtifact).not.toHaveBeenCalled();
    expect(publication.getFrame(0)?.text).toBe('first.xhtml');
    await backend.close();
  });
});
