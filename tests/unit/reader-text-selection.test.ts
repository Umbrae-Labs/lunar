import { describe, expect, it } from 'vitest';

import type { ReaderHitEntry, ReaderSourceRange } from '../../src/reader';
import {
  createReaderTextSelectionSearchQuery,
  createReaderTextSelection,
  createReaderTextSelectionFromSourceRange,
  createReaderWordSelectionAtPoint,
  findReaderHitIndex,
  findSelectableReaderHitIndex,
  resolveReaderTextSelectionSourceRange,
  updateReaderTextSelectionAtPoint,
  updateReaderTextSelectionBoundaryAtPoint,
} from '../../src/reader/interaction/text-selection';

const entries: ReaderHitEntry[] = [
  { pageIndex: 0, bounds: { x: 10, y: 20, width: 40, height: 16 }, text: 'First ', sourcePoint: { nodePath: [1, 0], textOffset: 0 }, textRange: { start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 }, end: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 6 } } },
  { pageIndex: 0, bounds: { x: 50, y: 20, width: 40, height: 16 }, text: 'line', sourcePoint: { nodePath: [1, 0], textOffset: 6 }, textRange: { start: { blockIndex: 0, lineIndex: 0, runIndex: 1, charIndex: 0 }, end: { blockIndex: 0, lineIndex: 0, runIndex: 1, charIndex: 4 } } },
  { pageIndex: 0, bounds: { x: 10, y: 42, width: 60, height: 16 }, text: 'Second', sourcePoint: { nodePath: [1, 1], textOffset: 0 }, textRange: { start: { blockIndex: 0, lineIndex: 1, runIndex: 0, charIndex: 0 }, end: { blockIndex: 0, lineIndex: 1, runIndex: 0, charIndex: 6 } } },
  { pageIndex: 0, bounds: { x: 80, y: 42, width: 20, height: 20 }, text: '', imageSource: 'image.png' },
];

describe('reader text selection', () => {
  it('finds the uppermost hit in display-list coordinates', () => {
    expect(findReaderHitIndex(entries, 55, 25)).toBe(1);
    expect(findReaderHitIndex(entries, 5, 5)).toBeUndefined();
  });

  it('uses a nearby text hit while a selection finger passes through spacing', () => {
    expect(findSelectableReaderHitIndex(entries, 8, 45)).toBe(2);
    expect(findSelectableReaderHitIndex(entries, 500, 500)).toBeUndefined();
  });

  it('creates forward and backward selections with visual line breaks', () => {
    expect(createReaderTextSelection(entries, 0, 2)?.text).toBe('First line\nSecond');
    expect(createReaderTextSelection(entries, 2, 0)?.entries).toHaveLength(3);
  });

  it('excludes image hits from copied text and overlay geometry', () => {
    const selection = createReaderTextSelection(entries, 2, 3);
    expect(selection?.text).toBe('Second');
    expect(selection?.bounds).toEqual([entries[2].bounds]);
  });

  it('starts at a word and extends by character with Rito geometry positions', () => {
    const initial = createReaderWordSelectionAtPoint(entries, 70, 25);
    expect(initial?.text).toBe('line');
    expect(initial?.geometryRequests).toEqual([{
      pageIndex: 0,
      start: { blockIndex: 0, lineIndex: 0, runIndex: 1, charIndex: 0 },
      end: { blockIndex: 0, lineIndex: 0, runIndex: 1, charIndex: 4 },
    }]);
    const extended = initial
      ? updateReaderTextSelectionAtPoint(entries, initial, 40, 49)
      : undefined;
    expect(extended?.text).toBe('line\nSec');
    expect(extended?.sourceRange).toEqual({
      start: { nodePath: [1, 0], textOffset: 6 },
      end: { nodePath: [1, 1], textOffset: 3 },
    });
  });

  it('reuses a selection when movement stays within the same character', () => {
    const initial = createReaderWordSelectionAtPoint(entries, 70, 25)!;
    expect(updateReaderTextSelectionAtPoint(entries, initial, 70, 25)).toBe(initial);
    expect(updateReaderTextSelectionBoundaryAtPoint(entries, initial, 'end', 90, 25)).toBe(initial);
  });

  it('moves either saved boundary and restores the selection from a source range', () => {
    const initial = createReaderTextSelection(entries, 0, 1);
    const moved = initial
      ? updateReaderTextSelectionBoundaryAtPoint(entries, initial, 'start', 30, 25)
      : undefined;
    expect(moved?.text).toBe('st line');
    expect(moved?.range.start).toEqual({ entryIndex: 0, charIndex: 3 });

    const restored = moved?.sourceRange
      ? createReaderTextSelectionFromSourceRange(entries, moved.sourceRange)
      : undefined;
    expect(restored?.text).toBe('st line');
  });

  it('resolves a missing source range from the matching Rito search result', () => {
    const sourceLessEntries = entries.map((entry) => ({ ...entry, sourcePoint: undefined }));
    const selection = createReaderTextSelection(sourceLessEntries, 0, 1);
    expect(selection?.sourceRange).toBeUndefined();
    expect(selection && createReaderTextSelectionSearchQuery(selection)).toBe('First line');

    const sourceRange = selection
      ? resolveReaderTextSelectionSourceRange(selection, [{
          pageIndex: 0,
          spreadIndex: 0,
          start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 },
          end: { blockIndex: 0, lineIndex: 0, runIndex: 1, charIndex: 4 },
          context: 'First line',
          locator: {
            spineIdref: 'chapter',
            manifestHref: 'chapter.xhtml',
            chapterProgress: 0,
            sourceRange: {
              start: { nodePath: [1, 0], textOffset: 0 },
              end: { nodePath: [1, 0], textOffset: 10 },
            },
          },
        }], 'chapter.xhtml')
      : undefined;
    expect(sourceRange).toEqual({
      start: { nodePath: [1, 0], textOffset: 0 },
      end: { nodePath: [1, 0], textOffset: 10 },
    });
  });

  it('uses the nearest same-page search result when gesture positions are approximate', () => {
    const sourceLessEntries = entries.map((entry) => ({ ...entry, sourcePoint: undefined }));
    const selection = createReaderTextSelection(sourceLessEntries, 0, 1);
    const farRange = {
      start: { nodePath: [1, 3], textOffset: 20 },
      end: { nodePath: [1, 3], textOffset: 30 },
    };
    const nearRange = {
      start: { nodePath: [1, 0], textOffset: 0 },
      end: { nodePath: [1, 0], textOffset: 10 },
    };
    const sourceRange = selection
      ? resolveReaderTextSelectionSourceRange(selection, [
          searchResult(3, 0, 3, 3, farRange),
          searchResult(0, 0, 0, 5, nearRange),
        ], 'chapter.xhtml')
      : undefined;
    expect(sourceRange).toEqual(nearRange);
  });

  it('requires every selected run to carry a source point before deriving a source range', () => {
    const generatedStartEntries = [
      { ...entries[0], sourcePoint: undefined },
      entries[1],
      entries[2],
    ];
    expect(createReaderTextSelection(generatedStartEntries, 0, 2)?.sourceRange).toBeUndefined();
  });

  it('preserves Rito visual-line separators in the search query', () => {
    const selection = createReaderTextSelection(entries, 0, 2);
    expect(selection && createReaderTextSelectionSearchQuery(selection)).toBe('First line\nSecond');
    expect(selection?.searchSegments.map((segment) => segment.text)).toEqual([
      'First line\nSecond',
    ]);
  });

  it('preserves larger paragraph gaps separately from visual line breaks', () => {
    const paragraphEntries = [
      entries[0],
      entries[1],
      {
        ...entries[2],
        bounds: { x: 10, y: 80, width: 60, height: 16 },
        text: 'Paragraph',
      },
    ];
    expect(createReaderTextSelection(paragraphEntries, 0, 2)?.text).toBe('First line\n\nParagraph');
  });
});

function searchResult(
  startLineIndex: number,
  startCharIndex: number,
  endLineIndex: number,
  endCharIndex: number,
  sourceRange: ReaderSourceRange,
) {
  return {
    pageIndex: 0,
    spreadIndex: 0,
    start: { blockIndex: 0, lineIndex: startLineIndex, runIndex: 0, charIndex: startCharIndex },
    end: { blockIndex: 0, lineIndex: endLineIndex, runIndex: 1, charIndex: endCharIndex },
    context: 'First line',
    locator: {
      spineIdref: 'chapter',
      manifestHref: 'chapter.xhtml',
      chapterProgress: 0,
      sourceRange,
    },
  };
}
