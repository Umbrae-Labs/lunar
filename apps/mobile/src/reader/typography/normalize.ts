import type { ReaderFontRef, ReaderFontRole, ReaderSpreadMode, ReaderTypography } from '../contracts';
import { LUNAR_READER_BUILTIN_FONT_REF } from './builtin-font';

/** Typography as persisted before roles carried their own fonts. */
export interface LegacyReaderTypography {
  readonly fontFamily?: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly marginHorizontal: number;
  readonly marginVertical: number;
  readonly spreadMode: ReaderSpreadMode;
}

/**
 * Accepts both the role-based shape and the flat shape it replaced. Values
 * persisted by an earlier build always named the bundled font, so the legacy
 * branch resolves to exactly what it used to mean.
 */
export function normalizeReaderTypography(typography: ReaderTypography | LegacyReaderTypography): ReaderTypography {
  const fonts =
    'fonts' in typography && typography.fonts !== undefined
      ? {
          body: normalizeFontRef(typography.fonts.body, 'body'),
          chrome: normalizeFontRef(typography.fonts.chrome, 'chrome'),
        }
      : { body: LUNAR_READER_BUILTIN_FONT_REF, chrome: LUNAR_READER_BUILTIN_FONT_REF };

  return {
    fonts,
    fontSize: requirePositiveFinite(typography.fontSize, 'fontSize'),
    lineHeight: requirePositiveFinite(typography.lineHeight, 'lineHeight'),
    marginHorizontal: requireNonNegativeFinite(typography.marginHorizontal, 'marginHorizontal'),
    marginVertical: requireNonNegativeFinite(typography.marginVertical, 'marginVertical'),
    spreadMode: typography.spreadMode,
  };
}

function normalizeFontRef(value: unknown, role: ReaderFontRole): ReaderFontRef {
  if (typeof value !== 'object' || value === null) {
    throw new RangeError(`Reader typography fonts.${role} must be a font reference.`);
  }
  const ref = value as Partial<ReaderFontRef>;
  const { source, family, importedFontId } = ref;
  if (source !== 'builtin' && source !== 'imported' && source !== 'system') {
    throw new RangeError(`Reader typography fonts.${role}.source is not a known font source.`);
  }
  if (typeof family !== 'string' || family.trim() === '') {
    throw new RangeError(`Reader typography fonts.${role}.family must not be empty.`);
  }
  // Rito measures body text from pinned font bytes, so a system face — which
  // exposes no bytes — cannot serve as the body font.
  if (role === 'body' && source === 'system') {
    throw new RangeError('Reader typography fonts.body cannot use a system font.');
  }
  if (source === 'imported') {
    if (typeof importedFontId !== 'string' || importedFontId === '') {
      throw new RangeError(`Reader typography fonts.${role} requires an importedFontId.`);
    }
    return { source, family, importedFontId };
  }
  return { source, family };
}

function requirePositiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Reader typography ${name} must be a positive finite number.`);
  }
  return value;
}

function requireNonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Reader typography ${name} must be a non-negative finite number.`);
  }
  return value;
}
