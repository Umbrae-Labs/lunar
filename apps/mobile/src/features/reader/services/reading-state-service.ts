import { getLunarDatabase } from '@/db';

import type { ReaderReadingState } from '../domain/reader-reading-state';
import { SQLiteReadingStateRepository } from '../repositories/sqlite-reading-state-repository';

export async function findReaderReadingState(bookId: string): Promise<ReaderReadingState | undefined> {
  const database = await getLunarDatabase();
  return new SQLiteReadingStateRepository(database).findByBookId(bookId);
}

export async function findMostRecentlyReadBookId(): Promise<string | undefined> {
  const database = await getLunarDatabase();
  return new SQLiteReadingStateRepository(database).findMostRecentlyReadBookId();
}

export async function saveReaderReadingState(state: ReaderReadingState): Promise<void> {
  const database = await getLunarDatabase();
  await new SQLiteReadingStateRepository(database).save(state);
}
