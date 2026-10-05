import { getLunarDatabase } from '../../../db';

import type { LibraryBookRecord } from '../domain/library-book';
import { ExpoBookFileService } from '../infrastructure/expo-book-file-service';
import { pickEpubs, type PickedEpub } from '../infrastructure/epub-picker';
import { SQLiteBookRepository } from '../repositories/sqlite-book-repository';
import { SQLiteBookAssetRepository } from '../repositories/sqlite-book-asset-repository';
import { BookImportService } from './book-import-service';
import type { BookImportProgressHandler } from './book-file-service';

export async function selectEpubFiles(): Promise<readonly PickedEpub[]> {
  return pickEpubs();
}

export async function importEpubFile(
  file: PickedEpub,
  onProgress?: BookImportProgressHandler,
): Promise<LibraryBookRecord> {
  const database = await getLunarDatabase();
  const importer = new BookImportService({
    files: new ExpoBookFileService(),
    books: new SQLiteBookRepository(database),
    assets: new SQLiteBookAssetRepository(database),
  });
  return importer.import(file.uri, file.fileName, onProgress);
}

export async function listLibraryBooks(): Promise<readonly LibraryBookRecord[]> {
  const database = await getLunarDatabase();
  const books = new SQLiteBookRepository(database);
  const files = new ExpoBookFileService();
  const importer = new BookImportService({ files, books });
  const records = await books.list();
  const hydrated: LibraryBookRecord[] = [];
  for (const record of records) {
    try {
      hydrated.push(await importer.ensureMetadata(record));
    } catch {
      hydrated.push(record);
    }
  }
  return hydrated;
}

export async function findLibraryBookById(bookId: string): Promise<LibraryBookRecord | undefined> {
  const database = await getLunarDatabase();
  return new SQLiteBookRepository(database).findById(bookId);
}

export interface RemoveLibraryBooksResult {
  readonly removedIds: readonly string[];
  readonly fileCleanupFailedIds: readonly string[];
}

export async function removeLibraryBooks(bookIds: readonly string[]): Promise<RemoveLibraryBooksResult> {
  const uniqueIds = Array.from(new Set(bookIds));
  if (uniqueIds.length === 0) {
    return { removedIds: [], fileCleanupFailedIds: [] };
  }

  const database = await getLunarDatabase();
  const books = new SQLiteBookRepository(database);
  const records = (await Promise.all(uniqueIds.map((bookId) => books.findById(bookId)))).filter(
    (record): record is LibraryBookRecord => record !== undefined,
  );

  await database.withExclusiveTransactionAsync(async (transaction) => {
    const transactionBooks = new SQLiteBookRepository(transaction);
    for (const bookId of uniqueIds) {
      await transactionBooks.remove(bookId);
    }
  });

  const files = new ExpoBookFileService();
  const fileCleanupFailedIds: string[] = [];
  for (const record of records) {
    try {
      await files.removeBook({
        bookId: record.id,
        uri: record.fileUri,
        fileName: record.fileName,
        fileSize: record.fileSize,
        sha256: record.sha256,
      });
    } catch {
      fileCleanupFailedIds.push(record.id);
    }
  }

  return {
    removedIds: uniqueIds,
    fileCleanupFailedIds,
  };
}
