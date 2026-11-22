import type { SQLiteDatabase } from 'expo-sqlite';
import { getLunarDatabase } from '@/db';
import { buildStatistics, type StatisticsBook } from '../domain/statistics';

export async function readStatistics(database: SQLiteDatabase) {
  // One read transaction gives overview, book rows and heatmap the same checkpoint.
  let result: ReturnType<typeof buildStatistics> | undefined;
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const books = await transaction.getAllAsync<StatisticsBook>(`
      SELECT b.id, b.title, b.author, b.cover_uri AS coverUri,
        MIN(1, MAX(0, COALESCE(r.fallback_progression, 0))) AS progress,
        COALESCE(s.milliseconds, 0) AS milliseconds
      FROM books b
      LEFT JOIN reading_states r ON r.book_id = b.id
      LEFT JOIN (SELECT book_id, SUM(ended_at - started_at) AS milliseconds
        FROM reading_sessions GROUP BY book_id) s ON s.book_id = b.id
      ORDER BY milliseconds DESC, b.title COLLATE NOCASE, b.id`);
    const sessions = await transaction.getAllAsync<{
      id: string;
      bookId: string;
      startedAt: number;
      endedAt: number;
      timeZone: string;
    }>(`SELECT id, book_id AS bookId, started_at AS startedAt, ended_at AS endedAt,
      time_zone AS timeZone FROM reading_sessions`);
    result = buildStatistics(books, sessions);
  });
  return result!;
}

export async function loadStatistics() {
  return readStatistics(await getLunarDatabase());
}
