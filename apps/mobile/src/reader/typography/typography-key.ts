import type { ReaderTypography } from '../contracts';
import { normalizeReaderTypography } from './normalize';

/**
 * Identifies the layout a typography value produces. Only the body font
 * participates: reader chrome is painted by the host and never reaches Rito's
 * line breaking, so changing it must not invalidate paginated artifacts.
 */
export function createReaderTypographyKey(typography: ReaderTypography): string {
  const normalized = normalizeReaderTypography(typography);
  const body = normalized.fonts.body;
  return JSON.stringify([
    body.source,
    body.family,
    body.importedFontId ?? '',
    normalized.fontSize,
    normalized.lineHeight,
    normalized.marginHorizontal,
    normalized.marginVertical,
    normalized.spreadMode,
  ]);
}
