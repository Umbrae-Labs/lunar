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

interface ReaderStoreState {
  readonly activeBookId?: string;
  readonly snapshot: ReaderSnapshot;
  /** Shared reading typography used by every reader session. */
  readonly typography: ReaderTypography;
  /** Shared page-turn animation used by every reader surface. */
  readonly animationStyle: ReaderPageAnimationStyle;
  readonly keepScreenAwake: boolean;
  readonly showSystemStatusBar: boolean;
  readonly volumeKeysTurnPages: boolean;
  setActiveBook(bookId: string): void;
  setSnapshot(snapshot: ReaderSnapshot): void;
  setTypography(typography: ReaderTypography): void;
  updateTypography(patch: Partial<ReaderTypography>): void;
  setAnimationStyle(style: ReaderPageAnimationStyle): void;
  setKeepScreenAwake(enabled: boolean): void;
  setShowSystemStatusBar(enabled: boolean): void;
  setVolumeKeysTurnPages(enabled: boolean): void;
  resetTypography(): void;
  reset(): void;
}

type PersistedReaderPreferences = Pick<
  ReaderStoreState,
  'typography' | 'animationStyle' | 'keepScreenAwake' | 'showSystemStatusBar' | 'volumeKeysTurnPages'
>;

const INITIAL_READER_SNAPSHOT: ReaderSnapshot = {
  phase: 'idle',
  revisionId: 0,
  spreadIndex: 0,
};

const DEFAULT_ANIMATION_STYLE: ReaderPageAnimationStyle = 'slide';

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
  persist<ReaderStoreState, [], [], PersistedReaderPreferences>(
    (set) => ({
      snapshot: INITIAL_READER_SNAPSHOT,
      typography: DEFAULT_READER_TYPOGRAPHY,
      animationStyle: DEFAULT_ANIMATION_STYLE,
      keepScreenAwake: false,
      showSystemStatusBar: false,
      volumeKeysTurnPages: false,
      setActiveBook: (bookId) => set({ activeBookId: bookId }),
      setSnapshot: (snapshot) => set({ snapshot }),
      setTypography: (typography) => set({ typography: normalizeReaderTypography(typography) }),
      updateTypography: (patch) =>
        set((state) => ({
          typography: normalizeReaderTypography({ ...state.typography, ...patch }),
        })),
      setAnimationStyle: (animationStyle) => set({ animationStyle: normalizeReaderAnimationStyle(animationStyle) }),
      setKeepScreenAwake: (keepScreenAwake) => set({ keepScreenAwake }),
      setShowSystemStatusBar: (showSystemStatusBar) => set({ showSystemStatusBar }),
      setVolumeKeysTurnPages: (volumeKeysTurnPages) => set({ volumeKeysTurnPages }),
      resetTypography: () => set({ typography: DEFAULT_READER_TYPOGRAPHY }),
      reset: () =>
        set({
          activeBookId: undefined,
          snapshot: INITIAL_READER_SNAPSHOT,
          typography: DEFAULT_READER_TYPOGRAPHY,
          animationStyle: DEFAULT_ANIMATION_STYLE,
          keepScreenAwake: false,
          showSystemStatusBar: false,
          volumeKeysTurnPages: false,
        }),
    }),
    {
      name: 'settings.reader',
      storage: createJSONStorage(() => mmkvStateStorage),
      partialize: ({ typography, animationStyle, keepScreenAwake, showSystemStatusBar, volumeKeysTurnPages }) => ({
        typography,
        animationStyle,
        keepScreenAwake,
        showSystemStatusBar,
        volumeKeysTurnPages,
      }),
      // A build before role-based fonts persisted a flat `fontFamily`, and the
      // hydrated value is handed straight to the reader. Normalizing here rather
      // than on first write keeps `typography.fonts` total for every consumer.
      merge: (persisted, current) => {
        const preferences = (persisted ?? {}) as Partial<PersistedReaderPreferences>;
        return {
          ...current,
          ...preferences,
          animationStyle: normalizeReaderAnimationStyle(preferences.animationStyle),
          typography: normalizeReaderTypography(preferences.typography ?? current.typography),
        };
      },
    },
  ),
);
