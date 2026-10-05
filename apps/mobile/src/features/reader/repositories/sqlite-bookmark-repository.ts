import type { SQLiteDatabase } from 'expo-sqlite';
import { bookmarkLocationKey, parseBookmarkLocator, type ReaderBookmark } from '../domain/reader-bookmark';
import type { BookmarkRepository } from './bookmark-repository';

interface BookmarkRow {
  id: string;
  book_id: string;
  locator_json: string;
  label: string | null;
  text: string;
  created_at: number;
}

export class SQLiteBookmarkRepository implements BookmarkRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async listByBookId(bookId: string): Promise<readonly ReaderBookmark[]> {
    const rows = await this.database.getAllAsync<BookmarkRow>(
      'SELECT * FROM bookmarks WHERE book_id = ? ORDER BY created_at DESC',
      bookId,
    );
    return rows.flatMap((row) => {
      const locator = parseBookmarkLocator(row.locator_json);
      return locator
        ? [
            {
              id: row.id,
              bookId: row.book_id,
              locator,
              label: row.label ?? '',
              text: row.text,
              createdAt: row.created_at,
            },
          ]
        : [];
    });
  }

  async save(bookmark: ReaderBookmark): Promise<ReaderBookmark> {
    let saved = bookmark;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const existing = (await new SQLiteBookmarkRepository(transaction).listByBookId(bookmark.bookId)).find(
        (item) => bookmarkLocationKey(item.locator) === bookmarkLocationKey(bookmark.locator),
      );
      if (existing) {
        saved = existing;
        return;
      }
      await transaction.runAsync(
        'INSERT INTO bookmarks (id, book_id, locator_json, label, text, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        bookmark.id,
        bookmark.bookId,
        JSON.stringify(bookmark.locator),
        bookmark.label,
        bookmark.text,
        bookmark.createdAt,
      );
    });
    return saved;
  }

  async remove(bookId: string, id: string): Promise<void> {
    await this.database.runAsync('DELETE FROM bookmarks WHERE book_id = ? AND id = ?', bookId, id);
  }
}
