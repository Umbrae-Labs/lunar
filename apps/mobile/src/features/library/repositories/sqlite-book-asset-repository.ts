import type { SQLiteDatabase } from 'expo-sqlite';

import type { ManagedBookAsset } from '../services/book-file-service';
import type { BookAssetRecord, BookAssetRepository } from './book-asset-repository';

interface BookAssetRow {
  readonly book_id: string;
  readonly path: string;
  readonly uri: string;
  readonly byte_size: number;
  readonly sha256: string | null;
}

export class SQLiteBookAssetRepository implements BookAssetRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async saveMany(bookId: string, assets: readonly ManagedBookAsset[]): Promise<void> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('DELETE FROM book_assets WHERE book_id = ?', bookId);
      for (const asset of assets) {
        await transaction.runAsync(
          `INSERT INTO book_assets (book_id, path, uri, byte_size, sha256)
           VALUES (?, ?, ?, ?, ?)`,
          bookId,
          asset.path,
          asset.uri,
          asset.byteSize,
          asset.sha256 ?? null,
        );
      }
    });
  }

  async listByBookId(bookId: string): Promise<readonly BookAssetRecord[]> {
    const rows = await this.database.getAllAsync<BookAssetRow>(
      'SELECT book_id, path, uri, byte_size, sha256 FROM book_assets WHERE book_id = ? ORDER BY path',
      bookId,
    );
    return rows.map((row) => ({
      bookId: row.book_id,
      path: row.path,
      uri: row.uri,
      byteSize: row.byte_size,
      sha256: row.sha256 ?? undefined,
    }));
  }

  async removeByBookId(bookId: string): Promise<void> {
    await this.database.runAsync('DELETE FROM book_assets WHERE book_id = ?', bookId);
  }
}
