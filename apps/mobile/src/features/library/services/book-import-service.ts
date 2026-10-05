import { inspectReaderBookAssets, type ReaderBookInspection } from '../../../reader';

import type { LibraryBookRecord } from '../domain/library-book';
import type { BookRepository } from '../repositories/book-repository';
import type { BookAssetRepository } from '../repositories/book-asset-repository';
import type { BookFileService, BookImportProgressHandler, ManagedBookFile } from './book-file-service';

export const CURRENT_BOOK_METADATA_VERSION = 2;

export type EpubInspector = (data: ArrayBuffer) => ReaderBookInspection;

export interface BookImportServiceOptions {
  readonly files: BookFileService;
  readonly books: BookRepository;
  readonly assets?: BookAssetRepository;
  readonly inspectEpub?: EpubInspector;
  readonly now?: () => number;
}

export class BookImportService {
  private readonly files: BookFileService;
  private readonly books: BookRepository;
  private readonly assets?: BookAssetRepository;
  private readonly inspectEpub: EpubInspector;
  private readonly now: () => number;

  constructor(options: BookImportServiceOptions) {
    this.files = options.files;
    this.books = options.books;
    this.assets = options.assets;
    this.inspectEpub = options.inspectEpub ?? inspectReaderBookAssets;
    this.now = options.now ?? Date.now;
  }

  async import(
    sourceUri: string,
    fileName: string,
    onProgress?: BookImportProgressHandler,
  ): Promise<LibraryBookRecord> {
    onProgress?.(0);
    const managedFile = await this.files.importEpub(sourceUri, fileName, (progress) => {
      onProgress?.(progress * 0.9);
    });
    onProgress?.(0.92);
    const previous = await this.books.findBySha256(managedFile.sha256);
    let savedBook = false;
    let savedBookId: string | undefined;

    try {
      const inspection = this.inspectEpub(await this.files.readBook(managedFile));
      onProgress?.(0.95);
      const coverUri = inspection.cover
        ? await this.files.saveCover(managedFile, inspection.cover)
        : previous?.coverUri;
      onProgress?.(0.97);
      const timestamp = this.now();
      const book = toLibraryBook(managedFile, inspection, coverUri, timestamp, previous);
      await this.books.save(book);
      savedBook = true;
      savedBookId = book.id;
      onProgress?.(0.985);
      if (this.assets && managedFile.assets) {
        await this.assets.saveMany(book.id, managedFile.assets);
      }
      onProgress?.(1);
      return book;
    } catch (error) {
      if (savedBook && !previous && savedBookId) {
        await this.books.remove(savedBookId).catch(() => undefined);
      }
      if (!previous) {
        await this.files.removeBook(managedFile).catch(() => undefined);
      }
      throw error;
    }
  }

  async ensureMetadata(book: LibraryBookRecord): Promise<LibraryBookRecord> {
    if (book.metadataVersion >= CURRENT_BOOK_METADATA_VERSION) {
      return book;
    }

    const managedFile = toManagedBookFile(book);
    const inspection = this.inspectEpub(await this.files.readBook(managedFile));
    const coverUri = inspection.cover ? await this.files.saveCover(managedFile, inspection.cover) : book.coverUri;
    const updated: LibraryBookRecord = {
      ...book,
      publisher: inspection.metadata.publisher ?? book.publisher,
      description: inspection.metadata.description ?? book.description,
      coverUri,
      metadataVersion: CURRENT_BOOK_METADATA_VERSION,
      updatedAt: this.now(),
    };
    await this.books.save(updated);
    return updated;
  }
}

function toLibraryBook(
  file: ManagedBookFile,
  inspection: ReaderBookInspection,
  coverUri: string | undefined,
  timestamp: number,
  previous?: LibraryBookRecord,
): LibraryBookRecord {
  const { metadata } = inspection;
  return {
    id: previous?.id ?? file.bookId,
    title: metadata.title,
    author: metadata.creator,
    language: metadata.language,
    epubIdentifier: metadata.identifier,
    publisher: metadata.publisher,
    description: metadata.description,
    fileUri: file.uri,
    fileName: file.fileName,
    fileSize: file.fileSize,
    sha256: file.sha256,
    coverUri,
    metadataVersion: CURRENT_BOOK_METADATA_VERSION,
    addedAt: previous?.addedAt ?? timestamp,
    lastOpenedAt: previous?.lastOpenedAt,
    updatedAt: timestamp,
  };
}

function toManagedBookFile(book: LibraryBookRecord): ManagedBookFile {
  return {
    bookId: book.id,
    uri: book.fileUri,
    fileName: book.fileName,
    fileSize: book.fileSize,
    sha256: book.sha256,
    assets: undefined,
  };
}
