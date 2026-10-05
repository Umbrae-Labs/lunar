import type { SQLiteDatabase } from 'expo-sqlite';

import type { ReadingSession } from '../domain/reading-time';

interface ReadingSessionRow {
  readonly id: string;
  readonly book_id: string;
  readonly started_at: number;
  readonly ended_at: number;
  readonly time_zone: string;
}

export class SQLiteReadingSessionRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async start(session: ReadingSession): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO reading_sessions (id, book_id, started_at, ended_at, time_zone)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
      session.id,
      session.bookId,
      session.startedAt,
      session.endedAt,
      session.timeZone,
    );
  }

  async updateEnd(id: string, endedAt: number): Promise<void> {
    await this.database.runAsync(
      `UPDATE reading_sessions SET ended_at = MAX(ended_at, ?)
       WHERE id = ?`,
      endedAt,
      id,
    );
  }

  async listByBookId(bookId: string): Promise<ReadingSession[]> {
    const rows = await this.database.getAllAsync<ReadingSessionRow>(
      `SELECT id, book_id, started_at, ended_at, time_zone
       FROM reading_sessions WHERE book_id = ? ORDER BY started_at DESC`,
      bookId,
    );
    return rows.map((row) => ({
      id: row.id,
      bookId: row.book_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      timeZone: row.time_zone,
    }));
  }
}
