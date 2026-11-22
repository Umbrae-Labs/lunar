import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  DEFAULT_READER_TYPOGRAPHY,
  normalizeReaderTypography,
  type ReaderSnapshot,
  type ReaderTypography,
} from '@/reader';
import type { ReaderPageAnimationStyle } from '@/reader/native';
import { mmkvStateStorage } from './mmkv-state-storage';
import {
  DEFAULT_READER_PAPER_COLORS,
  migrateReaderAppearancePreferences,
  normalizeReaderPaperColor,
  normalizeReaderPaperColors,
  type ReaderAppearanceMode,
  type ReaderPaperColor,
  type ReaderPaperColors,
} from './reader-appearance-preferences';
import {
  DEFAULT_EXCERPT_PREFERENCES,
  normalizeExcerptPreferences,
  type ReaderExcerptPreferences,
} from './reader-excerpt-preferences';

/**
 * How the reader moves through a book: `paged` turns pages left and right
 * with the chosen animation; `scroll` reads each chapter as one continuous
 * vertical strip.
 */
export type ReaderReadingMode = 'paged' | 'scroll';

/**
 * Where the reader's floating button rests: the screen edge it sticks to and its height as a
 * fraction of the room between the reader's controls, so it keeps its place on any screen size.
 */
export interface ReaderFloatingButtonPosition {
  readonly side: 'left' | 'right';
  readonly offset: number;
}

export const DEFAULT_FLOATING_BUTTON_POSITION: ReaderFloatingButtonPosition = { side: 'right', offset: 0.65 };

export function normalizeFloatingButtonPosition(value: unknown): ReaderFloatingButtonPosition {
  const candidate = (typeof value === 'object' && value !== null ? value : {}) as Partial<ReaderFloatingButtonPosition>;
  const offset =
    typeof candidate.offset === 'number' && Number.isFinite(candidate.offset)
      ? Math.min(1, Math.max(0, candidate.offset))
      : DEFAULT_FLOATING_BUTTON_POSITION.offset;
  return { side: candidate.side === 'left' ? 'left' : 'right', offset };
}

interface ReaderStoreState {
  readonly activeBookId?: string;
  readonly snapshot: ReaderSnapshot;
  readonly floatingButtonPosition: ReaderFloatingButtonPosition;
  setFloatingButtonPosition(position: ReaderFloatingButtonPosition): void;
  /** Shared reading typography used by every reader session. */
  readonly typography: ReaderTypography;
  readonly readingMode: ReaderReadingMode;
  /** Shared page-turn animation used by every reader surface in paged mode. */
  readonly animationStyle: ReaderPageAnimationStyle;
  readonly keepScreenAwake: boolean;
  readonly showSystemStatusBar: boolean;
  readonly volumeKeysTurnPages: boolean;
  /** Reader screen brightness, from 0.05 (dim) to 0.8 (reader maximum). */
  readonly brightness: number;
  /** Leave screen brightness to the system instead of applying `brightness`. */
  readonly followSystemBrightness: boolean;
  /** Paper choices for the two global appearance modes. */
  readonly paperColors: ReaderPaperColors;
  readonly excerptPreferences: ReaderExcerptPreferences;
  setExcerptPreferences(preferences: ReaderExcerptPreferences): void;
  setActiveBook(bookId: string): void;
  setSnapshot(snapshot: ReaderSnapshot): void;
  setTypography(typography: ReaderTypography): void;
  updateTypography(patch: Partial<ReaderTypography>): void;
  setReadingMode(mode: ReaderReadingMode): void;
  setAnimationStyle(style: ReaderPageAnimationStyle): void;
  setKeepScreenAwake(enabled: boolean): void;
  setShowSystemStatusBar(enabled: boolean): void;
  setVolumeKeysTurnPages(enabled: boolean): void;
  setBrightness(value: number): void;
  setFollowSystemBrightness(enabled: boolean): void;
  setPaperColor(mode: ReaderAppearanceMode, color: ReaderPaperColor): void;
  resetTypography(): void;
  reset(): void;
}

type PersistedReaderPreferences = Pick<
  ReaderStoreState,
  | 'typography'
  | 'readingMode'
  | 'animationStyle'
  | 'keepScreenAwake'
  | 'showSystemStatusBar'
  | 'volumeKeysTurnPages'
  | 'brightness'
  | 'followSystemBrightness'
  | 'paperColors'
  | 'excerptPreferences'
  | 'floatingButtonPosition'
>;

const INITIAL_READER_SNAPSHOT: ReaderSnapshot = {
  phase: 'idle',
  revisionId: 0,
  spreadIndex: 0,
};

const DEFAULT_ANIMATION_STYLE: ReaderPageAnimationStyle = 'slide';
const DEFAULT_READING_MODE: ReaderReadingMode = 'paged';

function normalizeReaderReadingMode(value: unknown): ReaderReadingMode {
  return value === 'scroll' ? 'scroll' : DEFAULT_READING_MODE;
}
export const MIN_READER_BRIGHTNESS = 0.05;
export const MAX_READER_BRIGHTNESS = 0.8;
export const DEFAULT_READER_BRIGHTNESS = 0.5;

export function normalizeReaderBrightness(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_READER_BRIGHTNESS;
  return Math.min(MAX_READER_BRIGHTNESS, Math.max(MIN_READER_BRIGHTNESS, numeric));
}

function normalizeReaderAnimationStyle(value: unknown): ReaderPageAnimationStyle {
  switch (value) {
    case 'none':
    case 'page':
    case 'slide':
      return value;
    case 'cover':
    case 'overlay':
      return 'none';
    case 'pageCurl':
    case 'simulation':
      return 'page';
    default:
      return DEFAULT_ANIMATION_STYLE;
  }
}

export const useReaderStore = create<ReaderStoreState>()(
  persist<ReaderStoreState, [], [], Partial<PersistedReaderPreferences>>(
    (set) => ({
      snapshot: INITIAL_READER_SNAPSHOT,
      typography: DEFAULT_READER_TYPOGRAPHY,
      readingMode: DEFAULT_READING_MODE,
      animationStyle: DEFAULT_ANIMATION_STYLE,
      keepScreenAwake: false,
      showSystemStatusBar: false,
      volumeKeysTurnPages: false,
      brightness: DEFAULT_READER_BRIGHTNESS,
      followSystemBrightness: true,
      paperColors: DEFAULT_READER_PAPER_COLORS,
      excerptPreferences: DEFAULT_EXCERPT_PREFERENCES,
      floatingButtonPosition: DEFAULT_FLOATING_BUTTON_POSITION,
      setFloatingButtonPosition: (position) =>
        set({ floatingButtonPosition: normalizeFloatingButtonPosition(position) }),
      setExcerptPreferences: (preferences) => set({ excerptPreferences: normalizeExcerptPreferences(preferences) }),
      setActiveBook: (bookId) => set({ activeBookId: bookId }),
      setSnapshot: (snapshot) => set({ snapshot }),
      setTypography: (typography) => set({ typography: normalizeReaderTypography(typography) }),
      updateTypography: (patch) =>
        set((state) => ({
          typography: normalizeReaderTypography({ ...state.typography, ...patch }),
        })),
      setReadingMode: (readingMode) => set({ readingMode: normalizeReaderReadingMode(readingMode) }),
      setAnimationStyle: (animationStyle) => set({ animationStyle: normalizeReaderAnimationStyle(animationStyle) }),
      setKeepScreenAwake: (keepScreenAwake) => set({ keepScreenAwake }),
      setShowSystemStatusBar: (showSystemStatusBar) => set({ showSystemStatusBar }),
      setVolumeKeysTurnPages: (volumeKeysTurnPages) => set({ volumeKeysTurnPages }),
      setBrightness: (brightness) => set({ brightness: normalizeReaderBrightness(brightness) }),
      setFollowSystemBrightness: (followSystemBrightness) => set({ followSystemBrightness }),
      setPaperColor: (mode, paperColor) =>
        set((state) => ({
          paperColors: { ...state.paperColors, [mode]: normalizeReaderPaperColor(paperColor) },
        })),
      resetTypography: () => set({ typography: DEFAULT_READER_TYPOGRAPHY }),
      reset: () =>
        set({
          activeBookId: undefined,
          snapshot: INITIAL_READER_SNAPSHOT,
          typography: DEFAULT_READER_TYPOGRAPHY,
          readingMode: DEFAULT_READING_MODE,
          animationStyle: DEFAULT_ANIMATION_STYLE,
          keepScreenAwake: false,
          showSystemStatusBar: false,
          volumeKeysTurnPages: false,
          brightness: DEFAULT_READER_BRIGHTNESS,
          followSystemBrightness: true,
          paperColors: DEFAULT_READER_PAPER_COLORS,
          excerptPreferences: DEFAULT_EXCERPT_PREFERENCES,
          floatingButtonPosition: DEFAULT_FLOATING_BUTTON_POSITION,
        }),
    }),
    {
      name: 'settings.reader',
      version: 1,
      migrate: migrateReaderAppearancePreferences,
      storage: createJSONStorage(() => mmkvStateStorage),
      partialize: ({
        typography,
        readingMode,
        animationStyle,
        keepScreenAwake,
        showSystemStatusBar,
        volumeKeysTurnPages,
        brightness,
        followSystemBrightness,
        paperColors,
        excerptPreferences,
        floatingButtonPosition,
      }) => ({
        typography,
        readingMode,
        animationStyle,
        keepScreenAwake,
        showSystemStatusBar,
        volumeKeysTurnPages,
        brightness,
        followSystemBrightness,
        paperColors,
        excerptPreferences,
        floatingButtonPosition,
      }),
      // A build before role-based fonts persisted a flat `fontFamily`, and the
      // hydrated value is handed straight to the reader. Normalizing here rather
      // than on first write keeps `typography.fonts` total for every consumer.
      merge: (persisted, current) => {
        const preferences = (persisted ?? {}) as Partial<PersistedReaderPreferences>;
        return {
          ...current,
          ...preferences,
          readingMode: normalizeReaderReadingMode(preferences.readingMode),
          animationStyle: normalizeReaderAnimationStyle(preferences.animationStyle),
          typography: normalizeReaderTypography(preferences.typography ?? current.typography),
          brightness: normalizeReaderBrightness(preferences.brightness),
          followSystemBrightness:
            typeof preferences.followSystemBrightness === 'boolean'
              ? preferences.followSystemBrightness
              : current.followSystemBrightness,
          paperColors: normalizeReaderPaperColors(preferences.paperColors),
          excerptPreferences: normalizeExcerptPreferences(preferences.excerptPreferences),
          floatingButtonPosition: normalizeFloatingButtonPosition(preferences.floatingButtonPosition),
        };
      },
    },
  ),
);
