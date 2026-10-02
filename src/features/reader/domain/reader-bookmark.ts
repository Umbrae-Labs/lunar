import type { ReaderHitEntry, ReaderLocator, ReaderRenderFrame, ReaderSnapshot, ReaderSourcePoint } from '@/reader';

export interface ReaderBookmark {
  readonly id: string;
  readonly bookId: string;
  readonly locator: ReaderLocator;
  readonly label: string;
  readonly text: string;
  readonly createdAt: number;
}

export function bookmarkLocationKey(locator: ReaderLocator): string {
  const point = locator.sourcePoint ?? locator.sourceRange?.start;
  return JSON.stringify([
    locator.manifestHref ?? locator.spineIdref,
    point ? [point.nodePath, point.textOffset] : [locator.anchorId ?? null, locator.chapterProgress],
  ]);
}

export function isBookmarkOnPage(
  bookmark: ReaderBookmark,
  locator: ReaderLocator,
  entries: readonly ReaderHitEntry[],
): boolean {
  if ((bookmark.locator.manifestHref ?? bookmark.locator.spineIdref) !== (locator.manifestHref ?? locator.spineIdref))
    return false;
  if (bookmarkLocationKey(bookmark.locator) === bookmarkLocationKey(locator)) return true;
  const point = bookmark.locator.sourcePoint ?? bookmark.locator.sourceRange?.start;
  if (point && entries.length > 0)
    return (
      entries.some(
        (entry) =>
          (entry.sourcePoint && sameSourcePoint(point, entry.sourcePoint)) ||
          (entry.sourcePoint &&
            sameNode(point, entry.sourcePoint) &&
            point.textOffset >= entry.sourcePoint.textOffset &&
            point.textOffset < entry.sourcePoint.textOffset + entry.text.length),
      ) || sameBookmarkText(bookmark.text, entries.map((entry) => entry.text).join(''))
    );
  if (!point && entries.length > 0) return sameBookmarkText(bookmark.text, entries.map((entry) => entry.text).join(''));
  return bookmarkLocationKey(bookmark.locator) === bookmarkLocationKey(locator);
}

export function hasBookmarkOnRenderedPage(
  bookmarks: readonly ReaderBookmark[],
  snapshot: ReaderSnapshot,
  frame: ReaderRenderFrame,
): boolean {
  const locator = snapshot.position?.locator;
  if (!locator) return false;
  const frameHref = frame.manifestHref ?? locator.manifestHref ?? locator.spineIdref;
  return bookmarks.some((bookmark) => {
    if ((bookmark.locator.manifestHref ?? bookmark.locator.spineIdref) !== frameHref) return false;
    const point = bookmark.locator.sourcePoint ?? bookmark.locator.sourceRange?.start;
    if (point)
      return Boolean(
        frame.hits?.some(
          (entry) =>
            (entry.sourcePoint && sameSourcePoint(point, entry.sourcePoint)) ||
            (entry.sourcePoint &&
              sameNode(point, entry.sourcePoint) &&
              point.textOffset >= entry.sourcePoint.textOffset &&
              point.textOffset < entry.sourcePoint.textOffset + entry.text.length),
        ) || sameBookmarkText(bookmark.text, frame.text ?? frame.hits?.map((entry) => entry.text).join('') ?? ''),
      );
    if (frame.hits?.length)
      return sameBookmarkText(bookmark.text, frame.text ?? frame.hits.map((entry) => entry.text).join(''));
    return Boolean(
      snapshot.position &&
      frame.pageIndices.includes(snapshot.position.pageIndex) &&
      bookmarkLocationKey(bookmark.locator) === bookmarkLocationKey(locator),
    );
  });
}

function sameNode(a: ReaderSourcePoint, b: ReaderSourcePoint) {
  return a.nodePath.length === b.nodePath.length && a.nodePath.every((part, index) => part === b.nodePath[index]);
}

function sameSourcePoint(a: ReaderSourcePoint, b: ReaderSourcePoint) {
  return sameNode(a, b) && a.textOffset === b.textOffset;
}

function sameBookmarkText(bookmarkText: string, pageText: string) {
  const bookmark = normalizeBookmarkText(bookmarkText);
  const page = normalizeBookmarkText(pageText);
  return bookmark.length > 0 && page.length > 0 && (page.startsWith(bookmark) || bookmark.startsWith(page));
}

function normalizeBookmarkText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

export function parseBookmarkLocator(json: string): ReaderLocator | undefined {
  try {
    const value = JSON.parse(json) as ReaderLocator;
    if (
      !value ||
      typeof value.spineIdref !== 'string' ||
      (value.manifestHref !== undefined && typeof value.manifestHref !== 'string') ||
      (value.anchorId !== undefined && typeof value.anchorId !== 'string') ||
      !Number.isFinite(value.chapterProgress) ||
      value.chapterProgress < 0 ||
      value.chapterProgress > 1 ||
      (value.sourcePoint !== undefined && !validPoint(value.sourcePoint)) ||
      (value.sourceRange !== undefined &&
        (!validPoint(value.sourceRange?.start) || !validPoint(value.sourceRange?.end)))
    )
      return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function validPoint(point: ReaderSourcePoint): boolean {
  return Boolean(
    point &&
    Array.isArray(point.nodePath) &&
    point.nodePath.every((part) => Number.isSafeInteger(part) && part >= 0) &&
    Number.isSafeInteger(point.textOffset) &&
    point.textOffset >= 0,
  );
}
