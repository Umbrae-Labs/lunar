import { randomUUID } from 'expo-crypto';
import { getLunarDatabase } from '@/db';
import type { ReaderBookmark } from '../domain/reader-bookmark';
import { SQLiteBookmarkRepository } from '../repositories/sqlite-bookmark-repository';

export async function listReaderBookmarks(bookId: string) {
  return new SQLiteBookmarkRepository(await getLunarDatabase()).listByBookId(bookId);
}

export async function saveReaderBookmark(input: Omit<ReaderBookmark, 'id' | 'createdAt'>) {
  return new SQLiteBookmarkRepository(await getLunarDatabase()).save({
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
  });
}

export async function removeReaderBookmark(bookId: string, id: string) {
  await new SQLiteBookmarkRepository(await getLunarDatabase()).remove(bookId, id);
}
