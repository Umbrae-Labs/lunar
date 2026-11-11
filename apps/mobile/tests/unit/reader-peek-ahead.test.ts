import { describe, expect, it, vi } from 'vitest';
import type { RitoAdjacentRequest, RitoArtifact } from '@umbrae-labs/rito-rn';
import { DEFAULT_READER_TYPOGRAPHY } from '../../src/reader/typography/defaults';
import { RitoNativePaginationBackend } from '../../src/reader/runtime/pagination/rito-native-pagination-backend';
import { LunarReaderRuntime } from '../../src/reader/runtime/core/native-reader-runtime';

const { openSession } = vi.hoisted(() => ({ openSession: vi.fn() }));
vi.mock('@umbrae-labs/rito-rn', () => ({ RitoReaderSession: { open: openSession } }));
vi.mock('../../src/reader/rito/pinned-font', () => ({
  loadBundledLunarFontBytes: async () => new Uint8Array(),
  createLunarRitoPinnedFonts: async () => ({ faces: [], registrations: [], bodyAlias: '' }),
}));
vi.mock('../../src/reader/skia/fonts/font-registry', () => ({
  LunarSkiaFontRegistry: class { loadBuiltinFont() {} },
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

/** A one-page artifact for page `page` of a book; its href tells the pages apart. */
function artifact(id: bigint, page: number): RitoArtifact {
  return {
    protocolVersion: 7, capabilityProfileId: 1, sessionId: 1n, requestId: id, revisionId: 1n,
    revisionVersion: 1, artifactId: id, locator: { href: `page-${page}.xhtml`, sourcePoint: { nodePath: [1], textOffset: 0n } },
    matchedBy: 'source-point', localPageIndex: 0, localSpreadIndex: 0, localPageIndexes: [0],
    width: 400, height: 800, navigation: { previous: page > 0 ? 'available' : 'terminal', next: 'available' },
    textProfile: 'platform-string-runs', resources: [], fonts: [], bookPageIndex: page, bookPageCount: 100,
    displayList: { formatVersion: 4, commandCount: 0, wireBytes: new Uint8Array([page]), displayList: { formatVersion: 4, ratio: 1, commandCount: 0, commands: [] } },
    pages: [{ pageIndex: 0, width: 400, height: 800 }],
  } as RitoArtifact;
}

async function setup(startPage = 10) {
  const pageOf = new Map<bigint, number>();
  const artifacts = new Map<bigint, RitoArtifact>();
  let nextId = 1n;
  const make = (page: number) => {
    const made = artifact(nextId++, page);
    artifacts.set(made.artifactId, made);
    pageOf.set(made.artifactId, page);
    return made;
  };
  const source = make(startPage);
  let visible = source;
  const session = {
    get currentVisibleArtifact() { return visible; },
    get currentVisibleArtifactId() { return visible.artifactId; },
    get nextRequestId() { return nextId; },
    readResource: vi.fn(async () => ({ bytes: new Uint8Array() })),
    // Every page is its own chapter, so a turn always crosses a chapter boundary.
    readPublication: async () => ({ metadata: { title: 'Book', language: 'en', identifier: 'book' },
      toc: Array.from({ length: 20 }, (_, page) => ({ label: `Chapter ${page}`, target: { kind: 'href', href: `page-${page}.xhtml` }, children: [] })),
      spine: [{ idref: 'page', href: 'page.xhtml' }] }),
    getArtifact: (id: bigint) => artifacts.get(id),
    readPage: vi.fn(async (artifactId: bigint, pageIndex: number) => ({ artifactId, pageIndex, hits: [], semantics: [],
      text: `page ${pageOf.get(artifactId)}`, textLength: 1n, textRuns: [] })),
    peekAdjacent: vi.fn(async (request: RitoAdjacentRequest) => {
      const from = pageOf.get(request.fromArtifactId)!;
      return make(from + (request.direction === 'next' ? 1 : -1));
    }),
    requestAdjacent: vi.fn(async (request: RitoAdjacentRequest) => {
      const from = pageOf.get(request.fromArtifactId)!;
      return make(from + (request.direction === 'next' ? 1 : -1));
    }),
    adoptForeground: vi.fn(async (request: { candidateArtifactId: bigint }) => { visible = artifacts.get(request.candidateArtifactId)!; }),
    advanceBackground: vi.fn(),
    adoptBackground: vi.fn(),
    releaseArtifact: vi.fn(async (id: bigint) => { artifacts.delete(id); }),
    dispose: vi.fn(async () => undefined),
  };
  openSession.mockImplementation(async () => ({ session, artifact: source }));
  const backend = new RitoNativePaginationBackend({ initialHref: 'page.xhtml' });
  // Background pagination is not under test; keep it from relabelling slots alongside the peek.
  vi.spyOn(backend, 'advanceBackground').mockImplementation(() => new Promise(() => undefined));
  const layout = { typography: { ...DEFAULT_READER_TYPOGRAPHY, spreadMode: 'single' as const }, theme: 'light' as const,
    viewport: { width: 400, height: 800, pixelRatio: 1 } };
  const runtime = new LunarReaderRuntime(async () => new ArrayBuffer(0), backend);
  const open = vi.spyOn(backend, 'open');
  await runtime.open({ ...layout, bookId: 'book', fileUri: 'book.epub' });
  const { publication } = await open.mock.results[0]!.value;
  return { backend, publication, runtime, session, pageOf, artifacts, source };
}

describe('peeking past the neighbors of the visible spread', () => {
  it('lays out two spreads each way without moving the visible artifact, and restores every slot', async () => {
    const { backend, publication, runtime, session } = await setup();
    try {
      const before = runtime.getSnapshot();
      const pages = await runtime.peekAdjacentPages(before.revisionId, before.spreadIndex, 'next', 2);
      expect(pages.map((page) => [page.direction, page.distance, page.frame.text])).toEqual([
        ['next', 1, 'page 11'],
        ['next', 2, 'page 12'],
        ['previous', 1, 'page 9'],
        ['previous', 2, 'page 8'],
      ]);
      // Each spread is labelled as the turn there labels it: one slot further out per turn.
      expect(pages.map((page) => page.snapshot.spreadIndex)).toEqual([1, 2, 0, 0]);
      expect(session.adoptForeground).not.toHaveBeenCalled();
      expect(session.requestAdjacent).not.toHaveBeenCalled();
      expect(runtime.getSnapshot()).toBe(before);
      // Every peeked artifact is released and the visible spread is back in its own slot.
      expect(session.releaseArtifact).toHaveBeenCalledTimes(4);
      expect(publication.getFrame(0)?.text).toBe('page 10');
      expect(publication.getFrame(1)).toBeUndefined();
      expect(publication.getFrame(2)).toBeUndefined();
    } finally {
      await backend.close();
    }
  });

  it('gives a peeked spread the identity the turn to it then publishes', async () => {
    const { backend, runtime } = await setup();
    try {
      const before = runtime.getSnapshot();
      const pages = await runtime.peekAdjacentPages(before.revisionId, before.spreadIndex, 'next', 2);
      const after = await runtime.next();
      const next = pages.find((page) => page.direction === 'next' && page.distance === 1)!;
      expect([after.spreadIndex, after.renderId]).toEqual([next.snapshot.spreadIndex, next.snapshot.renderId]);
      // Its chrome too: the composer holds the peeked texture until the surface paints the turn's snapshot.
      const chrome = (snapshot: typeof after) => [snapshot.chapterTitle, snapshot.bookSpreadIndex, snapshot.totalSpreads];
      expect(chrome(after)).toEqual(chrome(next.snapshot));
      const further = await runtime.next();
      const beyond = pages.find((page) => page.direction === 'next' && page.distance === 2)!;
      expect([further.spreadIndex, further.renderId]).toEqual([beyond.snapshot.spreadIndex, beyond.snapshot.renderId]);
    } finally {
      await backend.close();
    }
  });

  it('labels spreads peeked back from the first slot as the turns back label them', async () => {
    const { backend, runtime } = await setup();
    try {
      const before = runtime.getSnapshot();
      const pages = await runtime.peekAdjacentPages(before.revisionId, before.spreadIndex, 'previous', 2);
      const identity = (distance: number) => {
        const page = pages.find((candidate) => candidate.direction === 'previous' && candidate.distance === distance)!;
        return [page.snapshot.spreadIndex, page.snapshot.renderId];
      };
      const back = await runtime.previous();
      expect([back.spreadIndex, back.renderId]).toEqual(identity(1));
      const further = await runtime.previous();
      expect([further.spreadIndex, further.renderId]).toEqual(identity(2));
    } finally {
      await backend.close();
    }
  });

  it('leaves the visible slot naming the visible Picture after peeking back from the first slot', async () => {
    const { backend, runtime } = await setup();
    try {
      const before = runtime.getSnapshot();
      expect(before.spreadIndex).toBe(0);
      const visible = runtime.getCurrentPicture(before.revisionId, before.spreadIndex, before.renderId);
      await runtime.peekAdjacentPages(before.revisionId, before.spreadIndex, 'previous', 2);
      // A snapshot rebuilt from the slot, as background pagination does, shows the visible page.
      expect(runtime.getCurrentPicture(before.revisionId, before.spreadIndex)).toBe(visible);
    } finally {
      await backend.close();
    }
  });

  it('stops at the start of the book', async () => {
    const { backend, runtime } = await setup(1);
    try {
      const before = runtime.getSnapshot();
      const pages = await runtime.peekAdjacentPages(before.revisionId, before.spreadIndex, 'previous', 2);
      expect(pages.filter((page) => page.direction === 'previous').map((page) => page.frame.text)).toEqual(['page 0']);
    } finally {
      await backend.close();
    }
  });
});
