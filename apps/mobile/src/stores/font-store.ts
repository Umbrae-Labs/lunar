import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStateStorage } from './mmkv-state-storage';

/**
 * A font file the reader imported, as an index entry rather than a preference.
 *
 * `id` is the SHA-256 of the file's bytes, so importing the same file twice is
 * a no-op and replacing a file under the same name yields a new id — which is
 * what makes a font reference self-identifying and invalidates cached layouts
 * without a separate fingerprint. The bytes themselves live on disk; see the
 * reader feature's font storage.
 */
export interface ImportedReaderFont {
  readonly id: string;
  /** Family name read from the font's `name` table, falling back to the file name. */
  readonly family: string;
  readonly fileName: string;
  readonly uri: string;
  readonly byteLength: number;
  readonly style: 'normal' | 'italic';
  readonly weight: number;
  readonly addedAt: number;
}

interface FontStoreState {
  readonly fonts: readonly ImportedReaderFont[];
  /** Adds or replaces a font. Returns the stored entry. */
  addFont(font: ImportedReaderFont): ImportedReaderFont;
  /** Drops the index entry only; deleting the file is the caller's job. */
  removeFont(id: string): void;
  reset(): void;
}

type PersistedFonts = Pick<FontStoreState, 'fonts'>;

/**
 * Tolerates a corrupted or outdated persisted list: an entry without an id or
 * uri could never be resolved back to bytes, and keeping it would surface as a
 * font in the picker that fails when selected.
 */
function normalizeFonts(value: unknown): readonly ImportedReaderFont[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (font): font is ImportedReaderFont =>
      typeof font === 'object' &&
      font !== null &&
      typeof (font as ImportedReaderFont).id === 'string' &&
      (font as ImportedReaderFont).id !== '' &&
      typeof (font as ImportedReaderFont).uri === 'string' &&
      (font as ImportedReaderFont).uri !== '',
  );
}

export const useFontStore = create<FontStoreState>()(
  persist<FontStoreState, [], [], PersistedFonts>(
    (set) => ({
      fonts: [],
      addFont: (font) => {
        set((state) => ({
          fonts: [...state.fonts.filter((existing) => existing.id !== font.id), font],
        }));
        return font;
      },
      removeFont: (id) =>
        set((state) => ({
          fonts: state.fonts.filter((font) => font.id !== id),
        })),
      reset: () => set({ fonts: [] }),
    }),
    {
      name: 'settings.fonts',
      storage: createJSONStorage(() => mmkvStateStorage),
      partialize: ({ fonts }) => ({ fonts }),
      merge: (persisted, current) => ({
        ...current,
        fonts: normalizeFonts((persisted as Partial<PersistedFonts> | undefined)?.fonts),
      }),
    },
  ),
);
