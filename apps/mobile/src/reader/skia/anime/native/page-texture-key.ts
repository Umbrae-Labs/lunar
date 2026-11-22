import type { ReaderPageContent } from '../core/page-turn-types';

/** Texture appearance has its own identity; navigation keeps the original key. */
export function nativePageTextureKey(
  content: ReaderPageContent,
  layer: 'page' | 'chrome' = 'page',
  paintKey = '',
): string {
  return JSON.stringify([
    content.key,
    layer,
    content.bookmarked === true,
    content.overlays ?? [],
    content.snapshot.chapterTitle,
    content.snapshot.bookSpreadIndex,
    content.snapshot.totalSpreads,
    paintKey,
  ]);
}

/**
 * A scroll window's texture. The window carries no header or footer, so only
 * what it paints names it: stepping and peeking hand the same window back
 * under new snapshot identities, and background pagination renumbers the
 * book, neither of which may cost a new recording and upload.
 */
export function nativeScrollTextureKey(content: ReaderPageContent, paintKey: string): string {
  return JSON.stringify([content.frame.renderKey ?? content.key, 'scroll', content.overlays ?? [], paintKey]);
}
