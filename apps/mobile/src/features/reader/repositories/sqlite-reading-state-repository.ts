import type { SQLiteDatabase } from 'expo-sqlite';

import {
  DEFAULT_READER_TYPOGRAPHY,
  normalizeReaderTypography,
  type ReaderLocator,
  type ReaderPosition,
} from '@/reader';
import type { ReaderReadingState } from '../domain/reader-reading-state';
import type { ReadingStateRepository } from './reading-state-repository';

interface ReadingStateRow {
  readonly book_id: string;
  readonly locator_json: string;
  readonly fallback_progression: number;
  readonly current_page: number | null;
  readonly total_pages: number | null;
  readonly typography_json: string;
  readonly theme: 'light' | 'dark' | 'paper' | 'green';
  readonly updated_at: number;
}

interface RecentReadingStateRow {
  readonly book_id: string;
}

const RITO_READER_VERSION = '1';

export class SQLiteReadingStateRepository implements ReadingStateRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async findByBookId(bookId: string): Promise<ReaderReadingState | undefined> {
    const row = await this.database.getFirstAsync<ReadingStateRow>(
      'SELECT * FROM reading_states WHERE book_id = ? LIMIT 1',
      bookId,
    );
    return row ? fromRow(row) : undefined;
  }

  async findMostRecentlyReadBookId(): Promise<string | undefined> {
    const row = await this.database.getFirstAsync<RecentReadingStateRow>(
      `SELECT book_id
       FROM reading_states
       ORDER BY updated_at DESC, book_id ASC
       LIMIT 1`,
    );
    return row?.book_id;
  }

  async save(state: ReaderReadingState): Promise<void> {
    const position = state.position;
    const updatedAt = state.updatedAt;
    await this.database.runAsync(
      `INSERT INTO reading_states (
        book_id, locator_json, fallback_progression, current_page, total_pages,
        typography_json, theme, rito_version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(book_id) DO UPDATE SET
        locator_json = excluded.locator_json,
        fallback_progression = excluded.fallback_progression,
        current_page = excluded.current_page,
        total_pages = excluded.total_pages,
        typography_json = excluded.typography_json,
        theme = excluded.theme,
        rito_version = excluded.rito_version,
        updated_at = excluded.updated_at`,
      state.bookId,
      JSON.stringify(position.locator ?? null),
      clampProgression(position.progression),
      position.bookPageIndex ?? position.pageIndex,
      state.totalSpreads ?? null,
      JSON.stringify(state.typography),
      state.theme,
      RITO_READER_VERSION,
      updatedAt,
    );
    await this.database.runAsync('UPDATE books SET last_opened_at = ? WHERE id = ?', updatedAt, state.bookId);
  }

  async remove(bookId: string): Promise<void> {
    await this.database.runAsync('DELETE FROM reading_states WHERE book_id = ?', bookId);
  }
}

function fromRow(row: ReadingStateRow): ReaderReadingState | undefined {
  const position = toPosition(row);
  let typography = DEFAULT_READER_TYPOGRAPHY;
  try {
    typography = normalizeReaderTypography(JSON.parse(row.typography_json) as ReaderReadingState['typography']);
  } catch {
    // A malformed preference must not discard the saved reading position.
  }
  return {
    bookId: row.book_id,
    position,
    totalSpreads: row.total_pages ?? undefined,
    typography,
    theme: row.theme,
    updatedAt: row.updated_at,
  };
}

function toPosition(row: ReadingStateRow): ReaderPosition {
  let locator: ReaderLocator | undefined;
  try {
    const parsed = JSON.parse(row.locator_json) as ReaderLocator | null;
    locator = parsed ?? undefined;
  } catch {
    locator = undefined;
  }
  const pageIndex = row.current_page ?? 0;
  return {
    locator,
    progression: clampProgression(row.fallback_progression),
    pageIndex,
    spreadIndex: pageIndex,
    bookPageIndex: row.current_page ?? undefined,
    timestamp: row.updated_at,
  };
}

function clampProgression(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
