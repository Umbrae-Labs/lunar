import type { ReaderFontRef } from '../contracts';

/** Registration name of the bundled Lunar reader font. */
export const LUNAR_READER_FONT_FAMILY = 'LunarWenKai' as const;

/** The bundled face every role falls back to, and the CJK coverage guarantee. */
export const LUNAR_READER_BUILTIN_FONT_REF: ReaderFontRef = {
  source: 'builtin',
  family: LUNAR_READER_FONT_FAMILY,
};
