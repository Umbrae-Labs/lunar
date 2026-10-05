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
