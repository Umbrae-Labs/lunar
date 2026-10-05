import { afterEach, describe, expect, it, vi } from 'vitest';

const persistedValues = vi.hoisted(() => new Map<string, string>());

vi.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => persistedValues.get(key),
    remove: (key: string) => {
      persistedValues.delete(key);
    },
    set: (key: string, value: string) => {
      persistedValues.set(key, value);
    },
  }),
}));

import { type ImportedReaderFont, useFontStore } from '../../src/stores/font-store';

const FONT_KEY = 'settings.fonts';

afterEach(() => {
  useFontStore.getState().reset();
  persistedValues.clear();
});

describe('imported reader font catalog', () => {
  it('keeps the entry for a font the user imports', () => {
    useFontStore.getState().addFont(font('abc', 'Source Han Serif'));

    expect(useFontStore.getState().fonts).toHaveLength(1);
    expect(readPersisted().fonts).toHaveLength(1);
  });

  // The id is the file's digest, so re-importing the same bytes is the same font
  // however it was named — keeping both would offer the picker two entries that
  // resolve to one file.
  it('replaces an entry carrying an already-known digest', () => {
    useFontStore.getState().addFont(font('abc', 'Old Name'));
    useFontStore.getState().addFont(font('abc', 'New Name'));

    expect(useFontStore.getState().fonts).toEqual([font('abc', 'New Name')]);
  });

  it('drops only the entry that was removed', () => {
    useFontStore.getState().addFont(font('abc', 'One'));
    useFontStore.getState().addFont(font('def', 'Two'));

    useFontStore.getState().removeFont('abc');

    expect(useFontStore.getState().fonts).toEqual([font('def', 'Two')]);
  });

  it('discards persisted entries that could never resolve to bytes', async () => {
    persistedValues.set(
      FONT_KEY,
      JSON.stringify({
        state: {
          fonts: [
            font('abc', 'Good'),
            { ...font('def', 'No Uri'), uri: '' },
            { family: 'No Id' },
          ],
        },
        version: 0,
      }),
    );

    await useFontStore.persist.rehydrate();

    expect(useFontStore.getState().fonts).toEqual([font('abc', 'Good')]);
  });

  it('survives a persisted value that is not a list at all', async () => {
    persistedValues.set(FONT_KEY, JSON.stringify({ state: { fonts: 'nonsense' }, version: 0 }));

    await useFontStore.persist.rehydrate();

    expect(useFontStore.getState().fonts).toEqual([]);
  });
});

function font(id: string, family: string): ImportedReaderFont {
  return {
    id,
    family,
    fileName: `${family}.ttf`,
    uri: `file:///fonts/${id}/font.ttf`,
    byteLength: 1024,
    style: 'normal',
    weight: 400,
    addedAt: 1,
  };
}

function readPersisted(): { fonts: readonly ImportedReaderFont[] } {
  return JSON.parse(persistedValues.get(FONT_KEY) ?? '{}').state;
}
