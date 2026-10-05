import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { LibraryBookRecord } from '../../src/features/library/domain/library-book';
import type { BookRepository } from '../../src/features/library/repositories/book-repository';
import { BookImportService } from '../../src/features/library/services/book-import-service';
import type {
  BookFileService,
  ManagedBookFile,
} from '../../src/features/library/services/book-file-service';

const fixtureDirectory = resolve('tests/fixtures');
const fixtureName = readdirSync(fixtureDirectory).find((name) => name.endsWith('.epub'));

describe('BookImportService', () => {
  it('validates the managed EPUB and saves its package metadata', async () => {
    const data = readFixture();
    const managedFile: ManagedBookFile = {
      bookId: 'fixture-sha256',
      uri: 'file:///documents/books/fixture-sha256/book.epub',
      fileName: fixtureName!,
      fileSize: data.byteLength,
      sha256: 'fixture-sha256',
    };
    const files: BookFileService = {
      importEpub: vi.fn(async () => managedFile),
      readBook: vi.fn(async () => data),
      saveCover: vi.fn(async () => 'file:///documents/books/fixture-sha256/cover.jpg'),
      removeBook: vi.fn(async () => undefined),
    };
    const books = new MemoryBookRepository();
    const importer = new BookImportService({
      files,
      books,
      now: () => 1_777_777,
    });

    const book = await importer.import('file:///cache/fixture.epub', fixtureName!);

    expect(book).toMatchObject({
      id: 'fixture-sha256',
      title: '我买下了与她的每周密会～以五千圆为借口，共度两人时光～ 第三卷',
      author: '羽田宇佐',
      language: 'zh',
      epubIdentifier: 'calibre:23961',
      publisher: '富士见文库',
      description: expect.stringContaining('暑假结束后'),
      coverUri: 'file:///documents/books/fixture-sha256/cover.jpg',
      metadataVersion: 2,
      fileSize: data.byteLength,
      addedAt: 1_777_777,
      updatedAt: 1_777_777,
    });
    await expect(books.findBySha256('fixture-sha256')).resolves.toEqual(book);
    expect(files.saveCover).toHaveBeenCalledWith(
      managedFile,
      expect.objectContaining({
        source: 'Images/193982.jpg',
        mediaType: 'image/jpeg',
        fileExtension: 'jpg',
      }),
    );
    expect(files.removeBook).not.toHaveBeenCalled();
  });

  it('removes a new managed file when EPUB validation fails', async () => {
    const managedFile: ManagedBookFile = {
      bookId: 'invalid',
      uri: 'file:///documents/books/invalid/book.epub',
      fileName: 'invalid.epub',
      fileSize: 0,
      sha256: 'invalid',
    };
    const files: BookFileService = {
      importEpub: vi.fn(async () => managedFile),
      readBook: vi.fn(async () => new ArrayBuffer(0)),
      saveCover: vi.fn(async () => 'file:///unused-cover.jpg'),
      removeBook: vi.fn(async () => undefined),
    };
    const importer = new BookImportService({
      files,
      books: new MemoryBookRepository(),
    });

    await expect(importer.import('file:///cache/invalid.epub', 'invalid.epub')).rejects.toThrow();
    expect(files.removeBook).toHaveBeenCalledWith(managedFile);
  });

  it('reports import progress through file processing and persistence', async () => {
    const data = readFixture();
    const managedFile: ManagedBookFile = {
      bookId: 'progress-sha256',
      uri: 'file:///documents/books/progress-sha256/book.epub',
      fileName: fixtureName!,
      fileSize: data.byteLength,
      sha256: 'progress-sha256',
    };
    const files: BookFileService = {
      importEpub: vi.fn(async (_sourceUri, _fileName, onProgress) => {
        onProgress?.(0.5);
        return managedFile;
      }),
      readBook: vi.fn(async () => data),
      saveCover: vi.fn(async () => 'file:///documents/books/progress-sha256/cover.jpg'),
      removeBook: vi.fn(async () => undefined),
    };
    const importer = new BookImportService({ files, books: new MemoryBookRepository() });
    const progress: number[] = [];

    await importer.import('file:///cache/fixture.epub', fixtureName!, (value) => {
      progress.push(value);
    });

    expect(progress).toEqual([0, 0.45, 0.92, 0.95, 0.97, 0.985, 1]);
  });

  it('adds a cover to a book imported by an earlier app version', async () => {
    const data = readFixture();
    const existing: LibraryBookRecord = {
      id: 'existing-book',
      title: '旧记录',
      epubIdentifier: 'existing-id',
      fileUri: 'file:///documents/books/existing-book/book.epub',
      fileName: fixtureName!,
      fileSize: data.byteLength,
      sha256: 'existing-book',
      metadataVersion: 1,
      addedAt: 100,
      updatedAt: 100,
    };
    const files: BookFileService = {
      importEpub: vi.fn(async () => {
        throw new Error('Unused in this test.');
      }),
      readBook: vi.fn(async () => data),
      saveCover: vi.fn(async () => 'file:///documents/books/existing-book/cover.jpg'),
      removeBook: vi.fn(async () => undefined),
    };
    const books = new MemoryBookRepository();
    await books.save(existing);
    const importer = new BookImportService({ files, books, now: () => 200 });

    const hydrated = await importer.ensureMetadata(existing);

    expect(hydrated.coverUri).toBe('file:///documents/books/existing-book/cover.jpg');
    expect(hydrated.publisher).toBe('富士见文库');
    expect(hydrated.description).toContain('暑假结束后');
    expect(hydrated.metadataVersion).toBe(2);
    expect(hydrated.updatedAt).toBe(200);
    await expect(books.findById(existing.id)).resolves.toEqual(hydrated);
  });
});

class MemoryBookRepository implements BookRepository {
  private readonly records = new Map<string, LibraryBookRecord>();

  async save(book: LibraryBookRecord): Promise<void> {
    this.records.set(book.id, book);
  }

  async findById(id: string): Promise<LibraryBookRecord | undefined> {
    return this.records.get(id);
  }

  async findBySha256(sha256: string): Promise<LibraryBookRecord | undefined> {
    return Array.from(this.records.values()).find((book) => book.sha256 === sha256);
  }

  async list(): Promise<readonly LibraryBookRecord[]> {
    return Array.from(this.records.values());
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
  }
}

function readFixture(): ArrayBuffer {
  if (!fixtureName) {
    throw new Error('An EPUB fixture is required for the import test.');
  }
  const data = readFileSync(resolve(fixtureDirectory, fixtureName));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
