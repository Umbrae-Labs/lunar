import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { SQLiteReadingStateRepository } from '../../src/features/reader/repositories/sqlite-reading-state-repository';

vi.mock('@/reader', () => ({
  DEFAULT_READER_TYPOGRAPHY: {},
  normalizeReaderTypography: (typography: unknown) => typography,
}));

describe('SQLiteReadingStateRepository', () => {
  it('finds the book from the most recently updated reading state', async () => {
    const getFirstAsync = vi.fn(async () => ({ book_id: 'book-recent' }));
    const database = { getFirstAsync } as unknown as SQLiteDatabase;
    const repository = new SQLiteReadingStateRepository(database);

    await expect(repository.findMostRecentlyReadBookId()).resolves.toBe('book-recent');
    expect(getFirstAsync).toHaveBeenCalledWith(expect.stringContaining('ORDER BY updated_at DESC'));
  });

  it('returns undefined when no reading state has been saved', async () => {
    const database = {
      getFirstAsync: vi.fn(async () => null),
    } as unknown as SQLiteDatabase;
    const repository = new SQLiteReadingStateRepository(database);

    await expect(repository.findMostRecentlyReadBookId()).resolves.toBeUndefined();
  });
});
