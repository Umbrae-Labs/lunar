import { describe, expect, it } from 'vitest';

import { containsHighlightRange, mergeReaderHighlight, normalizeReaderHighlights } from '../../src/features/reader/domain/highlight-ranges';
import type { ReaderHighlight } from '../../src/features/reader/domain/reader-highlight';

function highlight(id: string, start: number, end: number, text = 'abcdefghij'.slice(start, end)): ReaderHighlight {
  return {
    id, bookId: 'book', href: 'chapter.xhtml', text, createdAt: 1, color: 'yellow',
    sourceRange: { start: { nodePath: [1, 0], textOffset: start }, end: { nodePath: [1, 0], textOffset: end } },
  };
}

describe('highlight range editing', () => {
  it('preserves notes during appearance changes and expansion over multiple marked passages', () => {
    const first = { ...highlight('first', 1, 3), notes: [{ id: 'a', content: '**first**', createdAt: 1, updatedAt: 1 }] };
    const second = { ...highlight('second', 5, 8), notes: [{ id: 'b', content: '> second', createdAt: 2, updatedAt: 2 }] };
    expect(mergeReaderHighlight([first], { ...highlight('edit', 1, 3), color: 'blue', style: 'wavy' }).highlight)
      .toMatchObject({ notes: first.notes, color: 'blue', style: 'wavy' });
    const expanded = mergeReaderHighlight([second, first], highlight('expand', 0, 9));
    expect(expanded.highlight.notes).toEqual([...first.notes, ...second.notes]);
    expect(expanded.removedIds).toHaveLength(2);
  });

  it('retains both notes when normalizing historical overlapping records', () => {
    const records = [{ ...highlight('a', 0, 5), notes: [{ id: 'a', content: 'first', createdAt: 1, updatedAt: 1 }] },
      { ...highlight('b', 3, 8), notes: [{ id: 'b', content: 'second', createdAt: 2, updatedAt: 2 }] }];
    const normalized = normalizeReaderHighlights(records);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].notes).toEqual([...records[0].notes, ...records[1].notes]);
  });
  it('changes the complete existing mark style and preserves it during recoloring', () => {
    const existing = { ...highlight('old', 1, 8), style: 'underline' as const };
    const changed = mergeReaderHighlight([existing], { ...highlight('new', 3, 5), style: 'wavy' });
    expect(changed.highlight).toMatchObject({ ...existing, style: 'wavy' });
    expect(mergeReaderHighlight([changed.highlight], { ...highlight('color', 3, 5), color: 'blue' }).highlight)
      .toMatchObject({ ...existing, color: 'blue', style: 'wavy' });
  });
  it('edits the complete existing highlight for a contained selection', () => {
    const existing = highlight('old', 1, 8);
    const result = mergeReaderHighlight([existing], { ...highlight('new', 3, 5), color: 'pink' });
    expect(result.highlight).toEqual({ ...existing, color: 'pink' });
    expect(result.removedIds).toEqual(['old']);
  });

  it('reuses an exact range without creating a duplicate', () => {
    const existing = highlight('old', 1, 8);
    expect(mergeReaderHighlight([existing], highlight('new', 1, 8)).highlight.id).toBe('old');
  });

  it('extends overlapping ranges in either direction', () => {
    for (const [existing, candidate] of [
      [highlight('old', 1, 5), highlight('new', 3, 8)],
      [highlight('old', 3, 8), highlight('new', 1, 5)],
    ]) {
      const result = mergeReaderHighlight([existing], candidate);
      expect(result.highlight.sourceRange).toEqual(highlight('merged', 1, 8).sourceRange);
      expect(result.highlight.text).toBe('bcdefgh');
    }
  });

  it('uses source offsets when the overlapping text repeats', () => {
    const result = mergeReaderHighlight([highlight('old', 0, 4, 'aaaa')], highlight('new', 2, 6, 'aaaa'));
    expect(result.highlight.text).toBe('aaaaaa');
  });

  it('merges all ranges covered by an expanded selection', () => {
    const result = mergeReaderHighlight([highlight('first', 1, 3), highlight('second', 5, 7)], highlight('new', 0, 9));
    expect(result.removedIds).toEqual(['first', 'second']);
    expect(result.highlight.text).toBe('abcdefghi');
  });

  it('includes transitively overlapping old records regardless of order', () => {
    const result = mergeReaderHighlight([highlight('second', 5, 9), highlight('first', 2, 6)], highlight('new', 0, 3));
    expect(result.removedIds).toHaveLength(2);
    expect(result.highlight.text).toBe('abcdefghi');
  });

  it('preserves adjacent ranges and ranges belonging to other chapters or books', () => {
    const existing = [highlight('adjacent', 4, 6), { ...highlight('chapter', 0, 4), href: 'other.xhtml' }, { ...highlight('book', 0, 4), bookId: 'other' }];
    expect(mergeReaderHighlight(existing, highlight('new', 0, 4)).removedIds).toEqual([]);
  });

  it('consolidates historical duplicates and retains the latest color', () => {
    const normalized = normalizeReaderHighlights([highlight('first', 0, 5), { ...highlight('last', 2, 7), color: 'green' }]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].color).toBe('green');
    expect(normalized[0].text).toBe('abcdefg');
  });

  it('compares source nodes numerically and honors half-open boundaries', () => {
    const range = { start: { nodePath: [1, 2], textOffset: 2 }, end: { nodePath: [1, 10], textOffset: 5 } };
    expect(containsHighlightRange(range, { start: { nodePath: [1, 3], textOffset: 0 }, end: range.end })).toBe(true);
    expect(containsHighlightRange(range, { start: range.start, end: { ...range.end, textOffset: 6 } })).toBe(false);
  });

  it('normalizes a large book without merging disjoint annotations', () => {
    const records = Array.from({ length: 2000 }, (_, index) => highlight(`record-${index}`, index * 4, index * 4 + 2, 'ab'));
    expect(normalizeReaderHighlights(records)).toHaveLength(records.length);
  });

  it('preserves the newest color when normalization sorts older records by source position', () => {
    const normalized = normalizeReaderHighlights([
      { ...highlight('old', 3, 8), createdAt: 1 },
      { ...highlight('new', 1, 5), color: 'blue', createdAt: 2 },
    ]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].color).toBe('blue');
    expect(normalized[0].text).toBe('bcdefgh');
  });
});
