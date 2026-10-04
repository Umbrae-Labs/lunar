import { afterEach, describe, expect, it, vi } from 'vitest';

import { useApplicationSettingsStore } from '../../src/stores/application-settings-store';
import { mmkvStateStorage } from '../../src/stores/mmkv-state-storage';
import { useLibraryStore } from '../../src/stores/library-store';
import { useReaderStore } from '../../src/stores/reader-store';

const persistedValues = vi.hoisted(() => new Map<string, string>());
const readerDefaults = vi.hoisted(() => ({
  fontFamily: 'LunarWenKai',
  fontSize: 18,
  lineHeight: 1.65,
  marginHorizontal: 24,
  marginVertical: 36,
  spreadMode: 'single' as const,
}));

vi.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => persistedValues.get(key),
    set: (key: string, value: string) => {
      persistedValues.set(key, value);
    },
    remove: (key: string) => persistedValues.delete(key),
  }),
}));

vi.mock('@/reader', () => ({
  DEFAULT_READER_TYPOGRAPHY: readerDefaults,
  normalizeReaderTypography: (typography: typeof readerDefaults) => {
    const numericValues = [
      typography.fontSize,
      typography.lineHeight,
      typography.marginHorizontal,
      typography.marginVertical,
    ];
    if (numericValues.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new RangeError('Invalid reader typography.');
    }
    return { ...typography, fontFamily: readerDefaults.fontFamily };
  },
}));

const APPLICATION_SETTINGS_KEY = 'settings.application';
const LIBRARY_SETTINGS_KEY = 'settings.library';
const READER_SETTINGS_KEY = 'settings.reader';

afterEach(() => {
  useApplicationSettingsStore.getState().setThemeMode('system');
  useApplicationSettingsStore.getState().setLanguage('system');
  useApplicationSettingsStore.getState().setResumeReadingOnLaunch(true);
  useLibraryStore.getState().resetSort();
  useReaderStore.getState().reset();
  mmkvStateStorage.removeItem(APPLICATION_SETTINGS_KEY);
  mmkvStateStorage.removeItem(LIBRARY_SETTINGS_KEY);
  mmkvStateStorage.removeItem(READER_SETTINGS_KEY);
});

describe('settings persistence', () => {
  it('stores the selected application theme mode in MMKV', () => {
    useApplicationSettingsStore.getState().setThemeMode('dark');

    expect(readPersistedState(APPLICATION_SETTINGS_KEY)).toEqual({
      themeMode: 'dark',
      language: 'system',
      resumeReadingOnLaunch: true,
    });
  });

  it('stores the selected application language in MMKV', () => {
    useApplicationSettingsStore.getState().setLanguage('en');

    expect(readPersistedState(APPLICATION_SETTINGS_KEY)).toEqual({
      themeMode: 'system',
      language: 'en',
      resumeReadingOnLaunch: true,
    });
  });

  it('stores the launch reading preference in MMKV', () => {
    useApplicationSettingsStore.getState().setResumeReadingOnLaunch(false);

    expect(readPersistedState(APPLICATION_SETTINGS_KEY)).toEqual({
      themeMode: 'system',
      language: 'system',
      resumeReadingOnLaunch: false,
    });
  });

  it('stores the selected library sorting field and direction in MMKV', () => {
    useLibraryStore.getState().setSortField('author');
    useLibraryStore.getState().setSortDirection('ascending');

    expect(readPersistedState(LIBRARY_SETTINGS_KEY)).toEqual({
      sort: {
        field: 'author',
        direction: 'ascending',
      },
    });
  });

  it('restores the library sorting preference from MMKV', async () => {
    mmkvStateStorage.setItem(
      LIBRARY_SETTINGS_KEY,
      JSON.stringify({
        state: {
          sort: {
            field: 'title',
            direction: 'descending',
          },
        },
        version: 0,
      }),
    );

    await useLibraryStore.persist.rehydrate();

    expect(useLibraryStore.getState().sort).toEqual({
      field: 'title',
      direction: 'descending',
    });
  });

  it('stores reader preferences without session state', () => {
    useReaderStore.getState().updateTypography({
      fontSize: 24,
      lineHeight: 1.8,
    });
    useReaderStore.getState().setAnimationStyle('page');
    useReaderStore.getState().setKeepScreenAwake(true);
    useReaderStore.getState().setShowSystemStatusBar(true);
    useReaderStore.getState().setVolumeKeysTurnPages(true);
    useReaderStore.getState().setActiveBook('book-1');

    expect(readPersistedState(READER_SETTINGS_KEY)).toEqual({
      typography: {
        ...readerDefaults,
        fontSize: 24,
        lineHeight: 1.8,
      },
      animationStyle: 'page',
      keepScreenAwake: true,
      brightness: 1,
      paperColors: { light: 'default', dark: 'default' },
      showSystemStatusBar: true,
      volumeKeysTurnPages: true,
      excerptPreferences: {
        theme: 'classic',
        background: 'ink',
        font: 'builtin',
      },
    });
  });
});

describe('reader paper preferences', () => {
  it('persists separate light and dark choices without modifying global appearance', async () => {
    useApplicationSettingsStore.getState().setThemeMode('dark');
    const applicationBefore = readPersistedState(APPLICATION_SETTINGS_KEY);
    useReaderStore.getState().setPaperColor('light', 'green');
    useReaderStore.getState().setPaperColor('dark', 'blue');
    expect(readPersistedState(READER_SETTINGS_KEY)).toMatchObject({ paperColors: { light: 'green', dark: 'blue' } });
    expect(readPersistedState(APPLICATION_SETTINGS_KEY)).toEqual(applicationBefore);

    await useReaderStore.persist.rehydrate();
    expect(useReaderStore.getState().paperColors).toEqual({ light: 'green', dark: 'blue' });
    useReaderStore.getState().setPaperColor('light', 'warm');
    expect(useReaderStore.getState().paperColors).toEqual({ light: 'warm', dark: 'blue' });
  });

  it.each([
    ['cream', 'warm'],
    ['green', 'green'],
    ['white', 'default'],
    ['dark', 'default'],
    ['auto', 'default'],
  ])('migrates the former %s choice and preserves other preferences', async (legacy, light) => {
    mmkvStateStorage.setItem(
      READER_SETTINGS_KEY,
      JSON.stringify({
        state: { paperColor: legacy, brightness: 0.6, animationStyle: 'page', typography: readerDefaults },
        version: 0,
      }),
    );
    await useReaderStore.persist.rehydrate();
    expect(useReaderStore.getState()).toMatchObject({
      paperColors: { light, dark: 'default' },
      brightness: 0.6,
      animationStyle: 'page',
      typography: readerDefaults,
    });
    expect(readPersistedState(READER_SETTINGS_KEY)).not.toHaveProperty('paperColor');
    expect(JSON.parse(mmkvStateStorage.getItem(READER_SETTINGS_KEY) as string).version).toBe(1);
  });

  it('restores defaults for old or malformed appearance values', async () => {
    for (const state of [{ brightness: 0.4 }, { paperColors: { light: 'unknown', dark: 'green' } }]) {
      mmkvStateStorage.setItem(READER_SETTINGS_KEY, JSON.stringify({ state, version: 1 }));
      await useReaderStore.persist.rehydrate();
      expect(useReaderStore.getState().paperColors).toEqual({
        light: 'default',
        dark: 'paperColors' in state ? 'green' : 'default',
      });
    }
  });
});

function readPersistedState(key: string): unknown {
  const storedValue = mmkvStateStorage.getItem(key);
  if (typeof storedValue !== 'string') {
    throw new Error(`Expected a persisted value for ${key}.`);
  }
  return (JSON.parse(storedValue) as { state: unknown }).state;
}
