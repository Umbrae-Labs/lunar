export type ReaderAppearanceMode = 'light' | 'dark';
export const READER_PAPER_COLORS = ['default', 'warm', 'green', 'blue', 'gray'] as const;
export type ReaderPaperColor = (typeof READER_PAPER_COLORS)[number];
export type ReaderPaperColors = Readonly<Record<ReaderAppearanceMode, ReaderPaperColor>>;

export const DEFAULT_READER_PAPER_COLORS: ReaderPaperColors = { light: 'default', dark: 'default' };

export function normalizeReaderPaperColor(value: unknown): ReaderPaperColor {
  return READER_PAPER_COLORS.includes(value as ReaderPaperColor) ? (value as ReaderPaperColor) : 'default';
}

export function normalizeReaderPaperColors(value: unknown): ReaderPaperColors {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<ReaderPaperColors>;
  return { light: normalizeReaderPaperColor(source.light), dark: normalizeReaderPaperColor(source.dark) };
}

/** Retain the former light paper choice; appearance is now always global. */
export function migrateReaderAppearancePreferences(value: unknown) {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const { paperColor, ...preferences } = source;
  return {
    ...preferences,
    paperColors: source.paperColors
      ? normalizeReaderPaperColors(source.paperColors)
      : ({
          light: paperColor === 'cream' ? 'warm' : paperColor === 'green' ? 'green' : 'default',
          dark: 'default',
        } satisfies ReaderPaperColors),
  };
}
