import type { SQLiteDatabase } from 'expo-sqlite';

import type { LibraryBookRecord } from '../domain/library-book';
import type { BookRepository } from './book-repository';

interface BookRow {
  readonly id: string;
  readonly title: string;
  readonly author: string | null;
  readonly language: string | null;
  readonly epub_identifier: string;
  readonly publisher: string | null;
  readonly description: string | null;
  readonly file_uri: string;
  readonly file_name: string;
  readonly file_size: number;
  readonly sha256: string;
  readonly cover_uri: string | null;
  readonly metadata_version: number;
  readonly added_at: number;
  readonly last_opened_at: number | null;
  readonly updated_at: number;
  readonly reading_progress?: number | null;
}

export class SQLiteBookRepository implements BookRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async save(book: LibraryBookRecord): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO books (
        id, title, author, language, epub_identifier, publisher, description,
        file_uri, file_name, file_size, sha256, cover_uri, metadata_version, added_at,
        last_opened_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sha256) DO UPDATE SET
        title = excluded.title,
        author = excluded.author,
        language = excluded.language,
        epub_identifier = excluded.epub_identifier,
        publisher = excluded.publisher,
        description = excluded.description,
        file_uri = excluded.file_uri,
        file_name = excluded.file_name,
        file_size = excluded.file_size,
        cover_uri = excluded.cover_uri,
        metadata_version = excluded.metadata_version,
        updated_at = excluded.updated_at`,
      book.id,
      book.title,
      book.author ?? null,
      book.language ?? null,
      book.epubIdentifier,
      book.publisher ?? null,
      book.description ?? null,
      book.fileUri,
      book.fileName,
      book.fileSize,
      book.sha256,
      book.coverUri ?? null,
      book.metadataVersion,
      book.addedAt,
      book.lastOpenedAt ?? null,
      book.updatedAt,
    );
  }

  async findById(id: string): Promise<LibraryBookRecord | undefined> {
    const row = await this.database.getFirstAsync<BookRow>('SELECT * FROM books WHERE id = ? LIMIT 1', id);
    return row ? fromBookRow(row) : undefined;
  }

  async findBySha256(sha256: string): Promise<LibraryBookRecord | undefined> {
    const row = await this.database.getFirstAsync<BookRow>('SELECT * FROM books WHERE sha256 = ? LIMIT 1', sha256);
    return row ? fromBookRow(row) : undefined;
  }

  async list(): Promise<readonly LibraryBookRecord[]> {
    const rows = await this.database.getAllAsync<BookRow>(
      `SELECT books.*, reading_states.fallback_progression AS reading_progress
       FROM books
       LEFT JOIN reading_states ON reading_states.book_id = books.id
       ORDER BY COALESCE(last_opened_at, added_at) DESC, title ASC`,
    );
    return rows.map(fromBookRow);
  }

  async remove(id: string): Promise<void> {
    await this.database.runAsync('DELETE FROM books WHERE id = ?', id);
  }
}

function fromBookRow(row: BookRow): LibraryBookRecord {
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? undefined,
    language: row.language ?? undefined,
    epubIdentifier: row.epub_identifier,
    publisher: row.publisher ?? undefined,
    description: row.description ?? undefined,
    fileUri: row.file_uri,
    fileName: row.file_name,
    fileSize: row.file_size,
    sha256: row.sha256,
    coverUri: row.cover_uri ?? undefined,
    metadataVersion: row.metadata_version,
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at ?? undefined,
    updatedAt: row.updated_at,
    readingProgress: clampProgression(row.reading_progress ?? 0),
  };
}

function clampProgression(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
