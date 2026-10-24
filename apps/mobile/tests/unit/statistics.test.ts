import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATABASE_MIGRATIONS } from '../../src/db/migrations';
import {
  buildHeatmap,
  buildStatistics,
  durationParts,
  heatLevel,
  selectPeriod,
  shiftDate,
} from '../../src/features/statistics/domain/statistics';
import { readStatistics } from '../../src/features/statistics/repositories/statistics-repository';
import { SQLiteReadingSessionRepository } from '../../src/features/reader/repositories/sqlite-reading-session-repository';

vi.mock('@/features/reader', async () => import('../../src/features/reader/domain/reading-time'));
vi.mock('@/db', () => ({ getLunarDatabase: vi.fn() }));
let sqlite: DatabaseSync | undefined;
afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
});

function database() {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of DATABASE_MIGRATIONS) for (const sql of migration.statements) sqlite.exec(sql);
  const db = {
    runAsync: async (sql: string, ...args: SQLInputValue[]) => sqlite!.prepare(sql).run(...args),
    getAllAsync: async (sql: string, ...args: SQLInputValue[]) => sqlite!.prepare(sql).all(...args),
    withExclusiveTransactionAsync: async (work: (transaction: SQLiteDatabase) => Promise<void>) => {
      sqlite!.exec('BEGIN');
      try {
        await work(db as unknown as SQLiteDatabase);
        sqlite!.exec('COMMIT');
      } catch (error) {
        sqlite!.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return db as unknown as SQLiteDatabase;
}
function addBook(id: string) {
  sqlite!
    .prepare(
      `INSERT INTO books (id,title,epub_identifier,file_uri,file_name,file_size,sha256,added_at,updated_at)
    VALUES (?,?,?,?,?,1,?,1,1)`,
    )
    .run(id, id, id, id, id, id);
}

describe('reading statistics', () => {
  it('has a real empty state and no division by zero', async () => {
    expect(await readStatistics(database())).toEqual({
      books: [],
      daily: [],
      dayBooks: {},
      total: 0,
      average: 0,
      completed: 0,
    });
  });
  it('reads persisted checkpoints, progress and per-book totals without multiplying joined rows', async () => {
    const db = database();
    addBook('first');
    addBook('second');
    addBook('unread');
    const repo = new SQLiteReadingSessionRepository(db);
    const start = Date.parse('2026-10-15T15:50:00Z');
    await repo.start({ id: 'one', bookId: 'first', startedAt: start, endedAt: start, timeZone: 'Asia/Shanghai' });
    await repo.updateEnd('one', start + 20 * 60_000);
    await repo.start({ id: 'two', bookId: 'first', startedAt: start, endedAt: start + 10 * 60_000, timeZone: 'UTC' });
    await repo.start({ id: 'three', bookId: 'second', startedAt: start, endedAt: start + 5 * 60_000, timeZone: 'UTC' });
    sqlite!
      .prepare(
        `INSERT INTO reading_states (book_id, locator_json, fallback_progression, typography_json, theme, rito_version, updated_at)
      VALUES ('first','{}',1,'{}','light','test',1)`,
      )
      .run();
    const result = await readStatistics(db);
    expect(result.total).toBe(35 * 60_000);
    expect(result.average).toBe(17.5 * 60_000);
    expect(result.completed).toBe(1);
    expect(result.dayBooks['2026-10-15'].map((book) => [book.id, book.milliseconds])).toEqual([
      ['first', 20 * 60_000],
      ['second', 5 * 60_000],
    ]);
    expect(result.dayBooks['2026-10-16'].map((book) => [book.id, book.milliseconds])).toEqual([['first', 10 * 60_000]]);
    expect(result.books.map((book) => [book.id, book.milliseconds, book.progress])).toEqual([
      ['first', 30 * 60_000, 1],
      ['second', 5 * 60_000, 0],
      ['unread', 0, 0],
    ]);
    expect(result.daily).toEqual([
      { date: '2026-10-16', milliseconds: 10 * 60_000 },
      { date: '2026-10-15', milliseconds: 25 * 60_000 },
    ]);
    // Reopening through a fresh query must use the saved data; deleting a book cascades.
    expect(await readStatistics(db)).toEqual(result);
    sqlite!.prepare("DELETE FROM books WHERE id = 'first'").run();
    const removed = await readStatistics(db);
    expect(removed.total).toBe(5 * 60_000);
    expect(removed.completed).toBe(0);
    expect(removed.books).toHaveLength(2);
  });
  it('covers a rolling year in Sunday-first weeks over year and leap-day boundaries and hides future dates', () => {
    const weeks = buildHeatmap('2024-03-01', [{ date: '2024-02-29', milliseconds: 1_800_000 }]);
    expect(weeks).toHaveLength(53);
    expect(weeks.flat()).toHaveLength(371);
    expect(weeks[0][0].date).toBe('2023-02-26');
    expect(weeks[52][4]).toMatchObject({ date: '2024-02-29', level: 2, future: false });
    expect(weeks[52][6]).toMatchObject({ date: '2024-03-02', future: true });
    expect(new Set(weeks.flat().map((day) => day.date)).size).toBe(371);
  });
  it('keeps Sunday and Saturday in the correct column and uses meaningful intensity levels', () => {
    const daily = [0, 1, 1_800_000, 3_600_000, 7_200_000].map((milliseconds, index) => ({
      date: `2026-10-${11 + index}`,
      milliseconds,
    }));
    expect(
      buildHeatmap('2026-10-17', daily)
        .at(-1)!
        .map((day) => day.level),
    ).toEqual([0, 1, 2, 3, 4, 0, 0]);
    expect(buildHeatmap('2026-10-11', []).at(-1)![0].date).toBe('2026-10-11');
  });
  it('formats seconds, minutes and hours without rounding into a false completion', () => {
    expect(durationParts(0)).toEqual({ hours: 0, minutes: 0, seconds: 0 });
    expect(durationParts(3_661_999)).toEqual({ hours: 1, minutes: 1, seconds: 1 });
    expect(
      buildStatistics([{ id: 'b', title: 'b', author: null, coverUri: null, progress: 0.9999, milliseconds: 0 }], [])
        .completed,
    ).toBe(0);
  });
});

describe('period statistics consistency', () => {
  const book = (id: string) => ({ id, title: id, author: null, coverUri: null, progress: 0, milliseconds: 99_999_999 });
  it('keeps history outside the heatmap year available to custom date ranges', () => {
    const startedAt = Date.parse('2020-02-29T12:00:00Z');
    const data = buildStatistics(
      [book('archive')],
      [
        {
          id: 'old',
          bookId: 'archive',
          startedAt,
          endedAt: startedAt + 600_000,
          timeZone: 'UTC',
        },
      ],
    );
    expect(
      buildHeatmap('2026-10-17', data.daily)
        .flat()
        .every((day) => day.milliseconds === 0),
    ).toBe(true);
    const archived = selectPeriod(data, { start: '2020-02-01', end: '2020-03-01' });
    expect(archived.daily).toHaveLength(30);
    expect(archived.total).toBe(600_000);
    expect(archived.books.map((row) => row.id)).toEqual(['archive']);
    expect(data.daily).toEqual([{ date: '2020-02-29', milliseconds: 600_000 }]);
  });
  it('uses inclusive dates, splits midnight and excludes lifetime and outside-period time everywhere', () => {
    const data = buildStatistics(
      [book('a'), book('b')],
      [
        {
          id: 'cross',
          bookId: 'a',
          startedAt: Date.parse('2025-12-31T23:50:00Z'),
          endedAt: Date.parse('2026-01-01T00:10:00Z'),
          timeZone: 'UTC',
        },
        {
          id: 'later',
          bookId: 'b',
          startedAt: Date.parse('2026-01-02T12:00:00Z'),
          endedAt: Date.parse('2026-01-02T12:30:00Z'),
          timeZone: 'UTC',
        },
      ],
    );
    const period = selectPeriod(data, { start: '2026-01-01', end: '2026-01-03' });
    expect(period.daily.map((day) => day.milliseconds)).toEqual([600_000, 1_800_000, 0]);
    expect(period.total).toBe(2_400_000);
    expect(period.average).toBe(800_000);
    expect(period.readingDays).toBe(2);
    expect(period.books.map((b) => [b.id, b.milliseconds])).toEqual([
      ['b', 1_800_000],
      ['a', 600_000],
    ]);
    expect(period.ranking.map((b) => b.share)).toEqual([0.75, 0.25]);
    expect(period.daily.reduce((sum, day) => sum + day.milliseconds, 0)).toBe(
      period.books.reduce((sum, b) => sum + b.milliseconds, 0),
    );
    const earlier = selectPeriod(data, { start: '2025-12-31', end: '2025-12-31' });
    expect(earlier.total).toBe(600_000);
    expect(earlier.books.map((b) => b.id)).toEqual(['a']);
    expect(period.total).toBe(2_400_000); // Switching ranges never mutates prior results.
  });
  it('retains all books in the strip while ranking only ten, with shares based on all books', () => {
    const books = Array.from({ length: 12 }, (_, i) => book(String(i)));
    const start = Date.parse('2026-10-10T00:00:00Z');
    const data = buildStatistics(
      books,
      books.map((b, i) => ({
        id: b.id,
        bookId: b.id,
        startedAt: start,
        endedAt: start + (i + 1) * 60_000,
        timeZone: 'UTC',
      })),
    );
    const period = selectPeriod(data, { start: '2026-10-10', end: '2026-10-10' });
    expect(period.books).toHaveLength(12);
    expect(period.ranking).toHaveLength(10);
    expect(period.ranking[0].share).toBe(12 / 78);
    expect(period.remaining).toBe(3 * 60_000);
    expect(period.ranking.reduce((sum, b) => sum + b.milliseconds, period.remaining)).toBe(period.total);
    expect(selectPeriod(data, { start: '2026-10-11', end: '2026-10-17' })).toMatchObject({
      books: [],
      ranking: [],
      total: 0,
      average: 0,
      readingDays: 0,
    });
  });
  it('preserves older history and uses exact half-hour, hour and two-hour boundaries', () => {
    expect([0, 1, 1_799_999, 1_800_000, 3_599_999, 3_600_000, 7_199_999, 7_200_000].map(heatLevel)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4,
    ]);
    expect(shiftDate('2024-03-01', -1)).toBe('2024-02-29');
    expect(() => selectPeriod(buildStatistics([], []), { start: '2026-10-17', end: '2026-10-16' })).toThrow();
    const cells = buildHeatmap('2024-03-01', [])
      .flat()
      .filter((d) => !d.future);
    expect(cells).toHaveLength(365);
    expect(cells.at(-1)?.date).toBe('2024-03-01');
  });
});
