import type { ReaderSourcePoint, ReaderSourceRange } from '@/reader';
import type { ReaderHighlight } from './reader-highlight';

export function compareHighlightPoints(left: ReaderSourcePoint, right: ReaderSourcePoint): number {
  for (let index = 0; index < Math.min(left.nodePath.length, right.nodePath.length); index += 1) {
    if (left.nodePath[index] !== right.nodePath[index]) return left.nodePath[index] - right.nodePath[index];
  }
  return left.nodePath.length - right.nodePath.length || left.textOffset - right.textOffset;
}

export function containsHighlightRange(container: ReaderSourceRange, value: ReaderSourceRange): boolean {
  return (
    compareHighlightPoints(container.start, value.start) <= 0 && compareHighlightPoints(container.end, value.end) >= 0
  );
}

export function mergeReaderHighlight(
  highlights: readonly ReaderHighlight[],
  candidate: ReaderHighlight,
): { readonly highlight: ReaderHighlight; readonly removedIds: readonly string[] } {
  let highlight = candidate;
  const removedIds = new Set<string>();
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const existing of highlights) {
      if (removedIds.has(existing.id) || existing.bookId !== candidate.bookId || existing.href !== candidate.href)
        continue;
      if (
        compareHighlightPoints(existing.sourceRange.end, highlight.sourceRange.start) <= 0 ||
        compareHighlightPoints(existing.sourceRange.start, highlight.sourceRange.end) >= 0
      )
        continue;
      removedIds.add(existing.id);
      expanded = true;
      if (containsHighlightRange(existing.sourceRange, highlight.sourceRange)) {
        highlight = { ...existing, color: candidate.color ?? existing.color, style: candidate.style ?? existing.style };
      } else if (!containsHighlightRange(highlight.sourceRange, existing.sourceRange)) {
        const existingFirst = compareHighlightPoints(existing.sourceRange.start, highlight.sourceRange.start) < 0;
        const first = existingFirst ? existing : highlight;
        const last = existingFirst ? highlight : existing;
        highlight = {
          ...highlight,
          sourceRange: { start: first.sourceRange.start, end: last.sourceRange.end },
          text: joinOverlappingText(first, last),
        };
      }
    }
  }
  // Preserve each note's identity when a selection absorbs several marks.
  const notes = [...highlights.filter((item) => removedIds.has(item.id)), candidate]
    .sort((left, right) => compareHighlightPoints(left.sourceRange.start, right.sourceRange.start))
    .flatMap((item) => item.notes ?? []);
  const byId = new Map(notes.map((note) => [note.id, note]));
  const mergedNotes = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  return {
    highlight: mergedNotes.length ? { ...highlight, notes: mergedNotes } : highlight,
    removedIds: [...removedIds],
  };
}

export function normalizeReaderHighlights(highlights: readonly ReaderHighlight[]): readonly ReaderHighlight[] {
  const ordered = [...highlights].sort(
    (left, right) =>
      left.bookId.localeCompare(right.bookId) ||
      left.href.localeCompare(right.href) ||
      compareHighlightPoints(left.sourceRange.start, right.sourceRange.start),
  );
  const normalized: ReaderHighlight[] = [];
  for (const candidate of ordered) {
    const previous = normalized.at(-1);
    if (!previous) {
      normalized.push(candidate);
      continue;
    }
    const { highlight, removedIds } = mergeReaderHighlight([previous], candidate);
    if (removedIds.length === 0) {
      normalized.push(candidate);
    } else {
      normalized[normalized.length - 1] = {
        ...highlight,
        color: candidate.createdAt >= previous.createdAt ? candidate.color : previous.color,
        style: candidate.createdAt >= previous.createdAt ? candidate.style : previous.style,
        createdAt: Math.max(candidate.createdAt, previous.createdAt),
      };
    }
  }
  return normalized.sort((left, right) => left.createdAt - right.createdAt);
}

function joinOverlappingText(first: ReaderHighlight, last: ReaderHighlight): string {
  const left = first.text.replace(/\r?\n/gu, '');
  const right = last.text.replace(/\r?\n/gu, '');
  if (
    first.sourceRange.end.nodePath.length === last.sourceRange.start.nodePath.length &&
    first.sourceRange.end.nodePath.every((part, index) => part === last.sourceRange.start.nodePath[index])
  ) {
    const overlap = first.sourceRange.end.textOffset - last.sourceRange.start.textOffset;
    if (overlap > 0 && overlap <= right.length && left.endsWith(right.slice(0, overlap))) {
      return left + right.slice(overlap);
    }
  }
  for (let length = Math.min(left.length, right.length); length > 0; length -= 1) {
    if (left.endsWith(right.slice(0, length))) return left + right.slice(length);
  }
  return `${first.text}\n${last.text}`;
}
