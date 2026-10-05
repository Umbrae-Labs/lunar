import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it } from 'vitest';

import { DATABASE_MIGRATIONS } from '../../src/db/migrations';
import { summarizeReadingTime, type ReadingSession } from '../../src/features/reader/domain/reading-time';
import { SQLiteReadingSessionRepository } from '../../src/features/reader/repositories/sqlite-reading-session-repository';

function session(id: string, start: string, end: string, timeZone: string): ReadingSession {
  return { id, bookId: 'book', startedAt: Date.parse(start), endedAt: Date.parse(end), timeZone };
}

describe('reading time', () => {
  it('allocates a session over local midnight to both dates', () => {
    const data = [session('one', '2026-09-24T15:50:00Z', '2026-09-24T16:10:00Z', 'Asia/Shanghai')];
    expect(summarizeReadingTime(data)).toEqual([
      { date: '2026-09-25', milliseconds: 10 * 60_000 },
      { date: '2026-09-24', milliseconds: 10 * 60_000 },
    ]);
  });

  it('uses the recorded zone and handles the daylight-saving transition', () => {
    const data = [
      session('new-york', '2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z', 'America/New_York'),
      session('shanghai', '2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z', 'Asia/Shanghai'),
    ];
    expect(summarizeReadingTime(data)).toEqual([
      { date: '2026-03-08', milliseconds: 2 * 60 * 60_000 },
    ]);
  });

  it('preserves each session’s original calendar date after travel', () => {
    const data = [
      session('shanghai', '2026-09-24T15:50:00Z', '2026-09-24T16:10:00Z', 'Asia/Shanghai'),
      session('new-york', '2026-09-24T15:50:00Z', '2026-09-24T16:10:00Z', 'America/New_York'),
    ];
    expect(summarizeReadingTime(data)).toEqual([
      { date: '2026-09-25', milliseconds: 10 * 60_000 },
      { date: '2026-09-24', milliseconds: 30 * 60_000 },
    ]);
  });

  it('persists checkpoints, keeps sessions distinct, and removes them with the book', async () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec('PRAGMA foreign_keys = ON');
      for (const migration of DATABASE_MIGRATIONS) {
        for (const statement of migration.statements) sqlite.exec(statement);
      }
      sqlite.prepare(`INSERT INTO books
        (id, title, epub_identifier, file_uri, file_name, file_size, sha256, added_at, updated_at)
        VALUES ('book', 'Book', 'book', 'book', 'book', 1, 'book', 1, 1)`).run();
      const database = {
        runAsync: async (sql: string, ...args: SQLInputValue[]) => sqlite.prepare(sql).run(...args),
        getAllAsync: async (sql: string, ...args: SQLInputValue[]) => sqlite.prepare(sql).all(...args),
      } as unknown as SQLiteDatabase;
      const repository = new SQLiteReadingSessionRepository(database);
      const first = session('first', '2026-09-24T10:00:00Z', '2026-09-24T10:00:00Z', 'Asia/Shanghai');
      await repository.start(first);
      await repository.start(first);
      await repository.updateEnd(first.id, first.startedAt + 60_000);
      await repository.updateEnd(first.id, first.startedAt + 30_000);
      expect(await repository.listByBookId('book')).toEqual([{ ...first, endedAt: first.startedAt + 60_000 }]);
      sqlite.prepare('DELETE FROM books WHERE id = ?').run('book');
      expect(await repository.listByBookId('book')).toEqual([]);
    } finally {
      sqlite.close();
    }
  });
});
