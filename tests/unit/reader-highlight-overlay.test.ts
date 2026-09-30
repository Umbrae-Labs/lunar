import { describe, expect, it, vi } from 'vitest';

vi.mock('@shopify/react-native-skia', () => ({ PaintStyle: {}, Skia: {} }));

import type {
  ReaderHitEntry,
  ReaderRuntime,
  ReaderSearchResult,
  ReaderSourceRange,
  ReaderRenderFrame,
  ReaderSnapshot,
} from '../../src/reader';
import {
  resolveReaderHighlightOverlays,
  resolveReaderSelectionSourceRange,
  createReaderHighlightOverlayResolver,
  createReaderHighlightRegions,
} from '../../src/features/reader/services/highlight-overlay-service';
import { createReaderTextSelection } from '../../src/reader/interaction/text-selection';
import { decorateReaderPageOverlays } from '../../src/reader/skia/rendering/reader-overlays';
import { nativeAutomaticPageTurnFaces } from '../../src/reader/skia/anime/native/page-turn';
import type { ReaderPageContent } from '../../src/reader/skia/anime/core/page-turn-types';

const entries: ReaderHitEntry[] = [
  hit('第一行', 0, 0),
  hit('第二行。', 1, 24),
];
const sourceRanges: ReaderSourceRange[] = [
  { start: { nodePath: [1, 0], textOffset: 0 }, end: { nodePath: [1, 0], textOffset: 3 } },
  { start: { nodePath: [1, 0], textOffset: 3 }, end: { nodePath: [1, 0], textOffset: 7 } },
];

describe('reader highlight overlays', () => {
  const colors = { yellow: '#ffee00', pink: '#ffaaaa', purple: '#bbaaff', blue: '#aabbff', green: '#aaffaa' };
  const highlight = {
    id: 'highlight', bookId: 'book', href: 'chapter.xhtml', createdAt: 1,
    text: '第一行第二行。',
    sourceRange: { start: sourceRanges[0].start, end: sourceRanges[1].end },
  };
  const sourceEntries = entries.map((entry, index) => ({ ...entry, sourcePoint: sourceRanges[index].start }));
  const snapshot = { revisionId: 7, spreadIndex: 0, position: { locator: { manifestHref: 'chapter.xhtml' } } } as ReaderSnapshot;
  const frame = { spreadIndex: 0, hits: sourceEntries } as ReaderRenderFrame;

  it.each(['underline', 'wavy'] as const)('retains %s geometry on both pages during a native turn', (style) => {
    const resolve = createReaderHighlightOverlayResolver([{ ...highlight, style }], colors);
    const source = decorateReaderPageOverlays({ key: 'source', snapshot, frame } as ReaderPageContent, resolve);
    const target = decorateReaderPageOverlays({ key: 'target', snapshot, frame: { ...frame, hits: sourceEntries.slice(1) } } as ReaderPageContent, resolve);
    const faces = nativeAutomaticPageTurnFaces({ id: 1, from: source, to: target, direction: 1 });
    expect(faces.front.overlays?.map((overlay) => overlay.decoration)).toEqual([style, style]);
    expect(faces.background.overlays?.[0]).toMatchObject({ decoration: style, thickness: 1.5, bounds: entries[1].bounds });
  });

  it('computes persistent overlays synchronously and caches them with the immutable frame', () => {
    const resolve = createReaderHighlightOverlayResolver([highlight], colors);
    const overlays = resolve(snapshot, frame);
    expect(overlays).toHaveLength(2);
    expect(resolve({ ...snapshot }, frame)).toBe(overlays);
    expect(overlays[0]).toEqual({ revisionId: 7, bounds: entries[0].bounds, color: colors.yellow, radius: 2 });
  });

  it('restores a saved source-backed selection without searching or retaining the selection overlay', async () => {
    const runtime = runtimeWithSearchResults([]);
    const selection = createReaderTextSelection(sourceEntries, 0, 1)!;
    const sourceRange = await resolveReaderSelectionSourceRange(runtime, selection, highlight.href);
    expect(sourceRange).toEqual(highlight.sourceRange);
    const stored = JSON.parse(JSON.stringify({ ...highlight, sourceRange }));
    const overlays = createReaderHighlightOverlayResolver([stored], colors)(snapshot, frame);
    expect(overlays.map((overlay) => overlay.bounds)).toEqual(selection.bounds);
    expect(runtime.search).not.toHaveBeenCalled();
    expect(runtime.resolveTextRangeGeometry).not.toHaveBeenCalled();
  });

  it('never searches the chapter for an off-page highlight when source coordinates exist', async () => {
    const runtime = runtimeWithSearchResults([]);
    const offPage = { ...highlight, sourceRange: { start: { nodePath: [9], textOffset: 0 }, end: { nodePath: [9], textOffset: 20 } } };
    const overlays = await resolveReaderHighlightOverlays(runtime, 7, highlight.href, sourceEntries, [offPage], colors.yellow);
    expect(overlays).toEqual([]);
    expect(runtime.search).not.toHaveBeenCalled();
    expect(runtime.resolveTextRangeGeometry).not.toHaveBeenCalled();
  });

  it('paints exact rectangles when the page has no hit entries', async () => {
    const runtime = runtimeWithSearchResults([], {
      status: 'resolved',
      firstPageIndex: 0,
      selectedText: highlight.text,
      rects: [{
        pageIndex: 0,
        bounds: { x: 12, y: 34, width: 56, height: 18 },
        blockIndex: 0,
        lineIndex: 0,
        runIndex: 0,
        startCharIndex: 0,
        endCharIndex: highlight.text.length,
      }],
    });
    await expect(
      resolveReaderHighlightOverlays(runtime, 7, highlight.href, [], [highlight], colors),
    ).resolves.toEqual([
      { revisionId: 7, bounds: { x: 12, y: 34, width: 56, height: 18 }, color: colors.yellow, radius: 2 },
    ]);
  });

  it('rebuilds every visible line when a source range resolves to a partial selection', async () => {
    const partial = {
      ...highlight,
      sourceRange: { start: { nodePath: [9], textOffset: 0 }, end: { nodePath: [9], textOffset: 4 } },
    };
    const runtime = runtimeWithSearchResults([], {
      status: 'resolved',
      firstPageIndex: 0,
      selectedText: '第二行。',
      rects: [{
        pageIndex: 0,
        bounds: entries[1].bounds,
        blockIndex: 0,
        lineIndex: 1,
        runIndex: 0,
        startCharIndex: 0,
        endCharIndex: entries[1].text.length,
      }],
    });
    const visibleEntries = entries.map((entry) => ({ ...entry, sourcePoint: undefined }));
    await expect(
      resolveReaderHighlightOverlays(runtime, 7, highlight.href, visibleEntries, [partial], colors.yellow),
    ).resolves.toEqual([
      { revisionId: 7, bounds: entries[0].bounds, color: colors.yellow, radius: 2 },
      { revisionId: 7, bounds: entries[1].bounds, color: colors.yellow, radius: 2 },
    ]);
    expect(createReaderHighlightRegions(visibleEntries, [partial], highlight.href)[0]?.selection.bounds).toEqual([
      entries[0].bounds,
      entries[1].bounds,
    ]);
  });

  it('clips a cross-page highlight to the current page while retaining its complete record', () => {
    const regions = createReaderHighlightRegions(sourceEntries.slice(1), [highlight], highlight.href);
    expect(regions).toHaveLength(1);
    expect(regions[0].highlight).toBe(highlight);
    expect(regions[0].selection.bounds).toEqual([entries[1].bounds]);
  });

  it('uses the prepared frame chapter even while the snapshot still names the source chapter', () => {
    const target = { ...highlight, href: 'target.xhtml', color: 'pink' as const };
    const resolve = createReaderHighlightOverlayResolver([highlight, target], colors);
    expect(resolve(snapshot, { ...frame, manifestHref: 'target.xhtml' })[0].color).toBe(colors.pink);
  });

  it('rebuilds geometry when a private slot is reused and invalidates colors and deletions', () => {
    const resolve = createReaderHighlightOverlayResolver([highlight], colors);
    const first = resolve(snapshot, frame);
    const replacement = { ...frame, hits: sourceEntries.map((entry) => ({ ...entry, bounds: { ...entry.bounds, y: 100 } })) };
    expect(resolve(snapshot, replacement)[0].bounds.y).toBe(100);
    expect(resolve({ ...snapshot, revisionId: 8 }, frame)[0].revisionId).toBe(8);
    expect(createReaderHighlightOverlayResolver([{ ...highlight, color: 'blue' }], colors)(snapshot, frame)[0].color).toBe(colors.blue);
    expect(createReaderHighlightOverlayResolver([], colors)(snapshot, frame)).toEqual([]);
    expect(first[0].color).toBe(colors.yellow);
  });

  it('carries both page highlights into forward and backward native tap-turn faces', () => {
    const resolve = createReaderHighlightOverlayResolver([highlight], colors);
    const source = { key: 'source', snapshot, frame } as ReaderPageContent;
    const target = { key: 'target', snapshot, frame: { ...frame, hits: sourceEntries.slice(1) } } as ReaderPageContent;
    const from = decorateReaderPageOverlays(source, resolve);
    const to = decorateReaderPageOverlays(target, resolve);
    for (const direction of [1, -1] as const) {
      const faces = nativeAutomaticPageTurnFaces({ id: 1, from, to, direction });
      expect(faces.front.overlays).toHaveLength(direction === 1 ? 2 : 1);
      expect(faces.background.overlays).toHaveLength(direction === 1 ? 1 : 2);
    }
    expect(source.overlays).toBeUndefined();
    expect(decorateReaderPageOverlays(source)).toBe(source);
  });

  it('resolves one page query containing a Chinese punctuation run', async () => {
    const runtime = runtimeWithSearchResults([
      searchResultAcrossLines('第一行\n第二行。', {
        start: sourceRanges[0].start,
        end: sourceRanges[1].end,
      }),
    ]);
    const selection = createReaderTextSelection(entries, 0, 1);

    await expect(selection
      ? resolveReaderSelectionSourceRange(runtime, selection, 'chapter.xhtml')
      : undefined).resolves.toEqual({
      start: sourceRanges[0].start,
      end: sourceRanges[1].end,
    });
    expect(runtime.search).toHaveBeenCalledTimes(1);
    expect(runtime.search).toHaveBeenNthCalledWith(1, {
      query: '第一行\n第二行。',
      caseSensitive: true,
      limit: 256,
    });
  });

  it('projects persisted multi-line highlight geometry through the exact source range', async () => {
    const runtime = runtimeWithSearchResults([], {
      status: 'resolved',
      firstPageIndex: 0,
      selectedText: '第一行第二行。',
      rects: entries.map((entry) => ({
        pageIndex: entry.pageIndex,
        bounds: entry.bounds,
        blockIndex: entry.textRange!.start.blockIndex,
        lineIndex: entry.textRange!.start.lineIndex,
        runIndex: entry.textRange!.start.runIndex,
        startCharIndex: entry.textRange!.start.charIndex,
        endCharIndex: entry.textRange!.end.charIndex,
      })),
    });
    const sourceRange = { start: sourceRanges[0].start, end: sourceRanges[1].end };
    const overlays = await resolveReaderHighlightOverlays(
      runtime,
      7,
      'chapter.xhtml',
      entries.map((entry) => ({ ...entry, sourcePoint: undefined })),
      [{
        id: 'highlight',
        bookId: 'book',
        href: 'chapter.xhtml',
        sourceRange,
        text: '第一行\n第二行。',
        createdAt: 1,
      }],
      '#ffee00',
    );

    expect(overlays).toEqual([
      { revisionId: 7, bounds: entries[0].bounds, color: '#ffee00', radius: 2 },
      { revisionId: 7, bounds: entries[1].bounds, color: '#ffee00', radius: 2 },
    ]);
  });
});

function hit(text: string, lineIndex: number, y: number): ReaderHitEntry {
  return {
    pageIndex: 0,
    bounds: { x: 10, y, width: 60, height: 18 },
    text,
    textRange: {
      start: { blockIndex: 0, lineIndex, runIndex: 0, charIndex: 0 },
      end: { blockIndex: 0, lineIndex, runIndex: 0, charIndex: text.length },
    },
    sourcePoint: undefined,
  };
}

function searchResult(
  context: string,
  lineIndex: number,
  sourceRange: ReaderSourceRange,
): ReaderSearchResult {
  return {
    pageIndex: 0,
    spreadIndex: 0,
    start: { blockIndex: 0, lineIndex, runIndex: 0, charIndex: 0 },
    end: { blockIndex: 0, lineIndex, runIndex: 0, charIndex: context.length },
    context,
    locator: {
      spineIdref: 'chapter',
      manifestHref: 'chapter.xhtml',
      chapterProgress: 0,
      sourceRange,
    },
  };
}

function runtimeWithSearchResults(
  results: readonly ReaderSearchResult[],
  exact: { status: 'resolved' | 'pending' | 'unavailable'; firstPageIndex?: number; selectedText: string; rects: readonly unknown[] } = {
    status: 'unavailable',
    selectedText: '',
    rects: [],
  },
): ReaderRuntime {
  return {
    search: vi.fn(async ({ query }) => ({
      query,
      truncated: false,
      searchedPageCount: 1,
      results: results.filter((result) => result.context === query),
    })),
    resolveTextRangeGeometry: vi.fn(async (request) => {
      return entries.filter((candidate) => {
        const lineIndex = candidate.textRange?.start.lineIndex;
        return lineIndex !== undefined
          && lineIndex >= request.start.lineIndex
          && lineIndex <= request.end.lineIndex;
      }).map((entry) => ({
        bounds: entry.bounds,
        blockIndex: entry.textRange!.start.blockIndex,
        lineIndex: entry.textRange!.start.lineIndex,
        runIndex: entry.textRange!.start.runIndex,
        startCharIndex: entry.textRange!.start.charIndex,
        endCharIndex: entry.textRange!.end.charIndex,
      }));
    }),
    resolveExactSourceRange: vi.fn(async () => exact),
  } as unknown as ReaderRuntime;
}

function searchResultAcrossLines(
  context: string,
  sourceRange: ReaderSourceRange,
): ReaderSearchResult {
  return {
    ...searchResult(context, 0, sourceRange),
    end: { blockIndex: 0, lineIndex: 1, runIndex: 0, charIndex: entries[1].text.length },
  };
}
