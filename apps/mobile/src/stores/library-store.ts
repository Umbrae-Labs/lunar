import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { mmkvStateStorage } from './mmkv-state-storage';

export const LIBRARY_SORT_FIELDS = ['addedAt', 'recentlyRead', 'title', 'author'] as const;

export const LIBRARY_SORT_DIRECTIONS = ['ascending', 'descending'] as const;

export type LibrarySortField = (typeof LIBRARY_SORT_FIELDS)[number];
export type LibrarySortDirection = (typeof LIBRARY_SORT_DIRECTIONS)[number];

export type LibrarySort = {
  readonly field: LibrarySortField;
  readonly direction: LibrarySortDirection;
};

export const DEFAULT_LIBRARY_SORT: LibrarySort = {
  field: 'recentlyRead',
  direction: 'descending',
};

interface LibraryStoreState {
  readonly sort: LibrarySort;
  setSortField(field: LibrarySortField): void;
  setSortDirection(direction: LibrarySortDirection): void;
  resetSort(): void;
}

type PersistedLibraryPreferences = Pick<LibraryStoreState, 'sort'>;

export const useLibraryStore = create<LibraryStoreState>()(
  persist<LibraryStoreState, [], [], PersistedLibraryPreferences>(
    (set) => ({
      sort: DEFAULT_LIBRARY_SORT,
      setSortField: (field) =>
        set((state) => ({
          sort: { ...state.sort, field },
        })),
      setSortDirection: (direction) =>
        set((state) => ({
          sort: { ...state.sort, direction },
        })),
      resetSort: () => set({ sort: DEFAULT_LIBRARY_SORT }),
    }),
    {
      name: 'settings.library',
      storage: createJSONStorage(() => mmkvStateStorage),
      partialize: ({ sort }) => ({ sort }),
    },
  ),
);

export function isLibrarySortField(value: unknown): value is LibrarySortField {
  return typeof value === 'string' && LIBRARY_SORT_FIELDS.some((field) => field === value);
}

export function isLibrarySortDirection(value: unknown): value is LibrarySortDirection {
  return typeof value === 'string' && LIBRARY_SORT_DIRECTIONS.some((direction) => direction === value);
}
