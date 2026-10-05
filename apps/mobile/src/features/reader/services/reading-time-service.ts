import { getLunarDatabase } from '@/db';

import type { ReadingSession } from '../domain/reading-time';
import { SQLiteReadingSessionRepository } from '../repositories/sqlite-reading-session-repository';

export async function startReadingSession(session: ReadingSession): Promise<void> {
  const database = await getLunarDatabase();
  await new SQLiteReadingSessionRepository(database).start(session);
}

export async function updateReadingSessionEnd(id: string, endedAt: number): Promise<void> {
  const database = await getLunarDatabase();
  await new SQLiteReadingSessionRepository(database).updateEnd(id, endedAt);
}

export async function listReadingSessions(bookId: string): Promise<ReadingSession[]> {
  const database = await getLunarDatabase();
  return new SQLiteReadingSessionRepository(database).listByBookId(bookId);
}
