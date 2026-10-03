export const ExcerptThemes = ['calendar', 'letter', 'classic'] as const;
export const ExcerptBackgrounds = ['ink', 'paper', 'white', 'navy', 'sage', 'rose'] as const;

export interface ReaderExcerptPreferences {
  readonly theme: (typeof ExcerptThemes)[number];
  readonly background: (typeof ExcerptBackgrounds)[number];
  /** Built-in face, platform default, or an entry in the imported font catalog. */
  readonly font: 'builtin' | 'system' | `imported:${string}`;
}

export const DEFAULT_EXCERPT_PREFERENCES: ReaderExcerptPreferences = {
  theme: 'classic',
  background: 'ink',
  font: 'builtin',
};

export function normalizeExcerptPreferences(value: unknown): ReaderExcerptPreferences {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<ReaderExcerptPreferences>;
  return {
    theme: ExcerptThemes.includes(source.theme!) ? source.theme! : DEFAULT_EXCERPT_PREFERENCES.theme,
    background: ExcerptBackgrounds.includes(source.background!)
      ? source.background!
      : DEFAULT_EXCERPT_PREFERENCES.background,
    font:
      source.font === 'system' ||
      source.font === 'builtin' ||
      (typeof source.font === 'string' && source.font.startsWith('imported:') && source.font.length > 9)
        ? source.font
        : DEFAULT_EXCERPT_PREFERENCES.font,
  };
}
