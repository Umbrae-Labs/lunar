import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import { unzipSync } from 'fflate';

import type {
  BookFileService,
  BookImportProgressHandler,
  ManagedBookAsset,
  ManagedBookCover,
  ManagedBookFile,
} from '../services/book-file-service';
import { releaseSharedObject, Sha256, sha256HexAsync, writeFileBytes, yieldToEventLoop } from './expo-file-io';
import { writeStoreZip } from './store-zip-writer';
import {
  inspectZipStream,
  normalizeZipEntryPath,
  readZipEntryBytes,
  type SeekableByteReader,
  type ZipStreamEntry,
} from './zip-stream-reader';

const EPUB_FILE_NAME = 'book.epub';
const MAX_EPUB_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 5_000;
const MAX_EXTRACTION_BATCH_BYTES = 4 * 1024 * 1024;
const MAX_EXTRACTION_BATCH_ENTRIES = 64;
const WRITE_YIELD_EVERY_ENTRIES = 16;
const HASH_READ_CHUNK_BYTES = 512 * 1024;
const YIELD_INTERVAL_BYTES = 2 * 1024 * 1024;

const ZIP_STREAM_LIMITS = {
  maxEntries: MAX_ENTRIES,
  maxEntryUncompressedBytes: MAX_ENTRY_UNCOMPRESSED_BYTES,
  maxTotalUncompressedBytes: MAX_TOTAL_UNCOMPRESSED_BYTES,
} as const;

interface ArchiveEntryDescriptor {
  readonly rawPath: string;
  readonly path: string;
  readonly originalSize: number;
}

interface ArchiveInspection {
  readonly entries: readonly ArchiveEntryDescriptor[];
  readonly isAlreadyStoreArchive: boolean;
}

interface OpenSeekableSource {
  readonly reader: SeekableByteReader;
  readonly handle: FileHandle;
  close(): void;
}

export class ExpoBookFileService implements BookFileService {
  async importEpub(
    sourceUri: string,
    fileName: string,
    onProgress?: BookImportProgressHandler,
  ): Promise<ManagedBookFile> {
    onProgress?.(0.04);
    assertEpubFileName(fileName);

    const source = new File(sourceUri);
    let seekable: OpenSeekableSource | undefined;
    let booksDirectory: Directory | undefined;
    let bookDirectory: Directory | undefined;
    let entriesDirectory: Directory | undefined;
    let target: File | undefined;

    try {
      if (!source.exists) {
        throw new Error('The selected EPUB file cannot be read.');
      }
      if (source.size > MAX_EPUB_ARCHIVE_BYTES) {
        throw new RangeError(`The selected EPUB exceeds the ${MAX_EPUB_ARCHIVE_BYTES} byte limit.`);
      }

      seekable = openSeekableSource(source);

      let fileSize: number;
      let sha256: string;
      let sourceBytes: Uint8Array | undefined;
      let streamInspection: ReturnType<typeof inspectZipStream> = null;
      let fallbackInspection: ArchiveInspection | undefined;

      if (seekable) {
        if (seekable.reader.size > MAX_EPUB_ARCHIVE_BYTES) {
          throw new RangeError(`The selected EPUB exceeds the ${MAX_EPUB_ARCHIVE_BYTES} byte limit.`);
        }
        const hashed = await hashSeekableSource(seekable.handle, seekable.reader.size, (progress) => {
          onProgress?.(0.04 + progress * 0.24);
        });
        fileSize = hashed.fileSize;
        if (fileSize > MAX_EPUB_ARCHIVE_BYTES) {
          throw new RangeError(`The selected EPUB exceeds the ${MAX_EPUB_ARCHIVE_BYTES} byte limit.`);
        }
        sha256 = hashed.sha256;
        onProgress?.(0.28);

        streamInspection = inspectZipStream(seekable.reader, ZIP_STREAM_LIMITS);
        if (!streamInspection) {
          // ZIP64 archive: close handle and fall back to full-buffer fflate parsing.
          seekable.close();
          seekable = undefined;
          sourceBytes = await source.bytes();
          fallbackInspection = inspectArchiveEntries(sourceBytes);
        }
      } else {
        sourceBytes = await source.bytes();
        onProgress?.(0.18);
        fileSize = sourceBytes.byteLength;
        if (fileSize > MAX_EPUB_ARCHIVE_BYTES) {
          throw new RangeError(`The selected EPUB exceeds the ${MAX_EPUB_ARCHIVE_BYTES} byte limit.`);
        }
        sha256 = await sha256HexAsync(sourceBytes);
        onProgress?.(0.28);
        fallbackInspection = inspectArchiveEntries(sourceBytes);
      }

      const bookId = sha256;
      booksDirectory = new Directory(Paths.document, 'books');
      booksDirectory.create({ intermediates: true, idempotent: true });
      bookDirectory = new Directory(booksDirectory, bookId);
      bookDirectory.create({ intermediates: true, idempotent: true });
      target = new File(bookDirectory, EPUB_FILE_NAME);
      const hadManagedArchive = target.exists;
      onProgress?.(0.36);

      entriesDirectory = new Directory(bookDirectory, 'entries');
      entriesDirectory.create({ intermediates: true, idempotent: true });

      const isAlreadyStoreArchive = streamInspection
        ? streamInspection.isAlreadyStoreArchive
        : fallbackInspection!.isAlreadyStoreArchive;

      let assets: readonly ManagedBookAsset[];
      try {
        if (streamInspection && seekable) {
          assets = await extractEntriesFromStream(
            seekable.reader,
            streamInspection.entries,
            entriesDirectory,
            (progress) => {
              onProgress?.(0.36 + progress * 0.46);
            },
          );
          seekable.close();
          seekable = undefined;
        } else {
          assets = await extractEntriesInBatches(
            sourceBytes!,
            fallbackInspection!.entries,
            entriesDirectory,
            (progress) => {
              onProgress?.(0.36 + progress * 0.46);
            },
          );
          // Release the full source archive before writing or repacking book.epub.
          sourceBytes = undefined;
        }

        if (isAlreadyStoreArchive) {
          // Plugin-built and uncompressed EPUBs already store every entry with
          // ZIP method STORE and `mimetype` first; copy directly without re-zipping.
          if (target.exists && target.size !== fileSize) {
            target.delete();
          }
          if (!target.exists) {
            await source.copy(target);
          }
        } else {
          // Rito still receives a complete EPUB, while all entries are stored with
          // ZIP method STORE. Stream one extracted entry at a time into book.epub
          // instead of holding a second full copy of the archive in JS memory.
          await repackStoreEpub(target, assets, (progress) => {
            onProgress?.(0.82 + progress * 0.08);
          });
        }
      } catch (error) {
        if (!hadManagedArchive) {
          try {
            bookDirectory.delete();
          } catch {
            // Best-effort cleanup after a failed import.
          }
        }
        throw error;
      }

      onProgress?.(0.9);
      return {
        bookId,
        uri: target.uri,
        fileName,
        fileSize,
        sha256,
        assets,
      };
    } finally {
      seekable?.close();
      releaseSharedObject(target);
      releaseSharedObject(entriesDirectory);
      releaseSharedObject(bookDirectory);
      releaseSharedObject(booksDirectory);
      releaseSharedObject(source);
    }
  }

  async readBook(book: ManagedBookFile): Promise<ArrayBuffer> {
    const file = new File(book.uri);
    try {
      if (!file.exists) {
        throw new Error(`Managed EPUB is missing for book ${book.bookId}.`);
      }
      return await file.arrayBuffer();
    } finally {
      releaseSharedObject(file);
    }
  }

  async readAsset(book: ManagedBookFile, path: string): Promise<Uint8Array | undefined> {
    const asset = book.assets?.find((item) => item.path === path);
    if (!asset) {
      return undefined;
    }
    const file = new File(asset.uri);
    try {
      return file.exists ? await file.bytes() : undefined;
    } finally {
      releaseSharedObject(file);
    }
  }

  async saveCover(book: ManagedBookFile, cover: ManagedBookCover): Promise<string> {
    const extension = sanitizeCoverExtension(cover.fileExtension);
    const bookFile = new File(book.uri);
    const parent = bookFile.parentDirectory;
    const target = new File(parent, `cover.${extension}`);
    try {
      writeFileBytes(target, cover.bytes);
      return target.uri;
    } finally {
      releaseSharedObject(target);
      releaseSharedObject(parent);
      releaseSharedObject(bookFile);
    }
  }

  async removeBook(book: ManagedBookFile): Promise<void> {
    const bookFile = new File(book.uri);
    const directory = bookFile.parentDirectory;
    try {
      if (directory.exists) {
        directory.delete();
      }
    } finally {
      releaseSharedObject(directory);
      releaseSharedObject(bookFile);
    }
  }
}

function openSeekableSource(source: File): OpenSeekableSource | undefined {
  let handle: FileHandle | undefined;
  try {
    handle = source.open(FileMode.ReadOnly);
    const size = handle.size;
    if (size === null || !Number.isFinite(size) || size < 0) {
      closeFileHandle(handle);
      return undefined;
    }
    handle.offset = 0;
    if (handle.offset !== 0) {
      closeFileHandle(handle);
      return undefined;
    }
    const reader: SeekableByteReader = {
      size,
      readAt(offset: number, length: number): Uint8Array {
        handle!.offset = offset;
        return handle!.readBytes(length);
      },
    };
    return {
      reader,
      handle,
      close() {
        closeFileHandle(handle);
        handle = undefined;
      },
    };
  } catch {
    closeFileHandle(handle);
    return undefined;
  }
}

function closeFileHandle(handle: FileHandle | undefined): void {
  if (!handle) return;
  try {
    handle.close();
  } catch {
    // Best-effort handle close.
  }
  releaseSharedObject(handle);
}

async function hashSeekableSource(
  handle: FileHandle,
  totalSize: number,
  onProgress?: BookImportProgressHandler,
): Promise<{ readonly fileSize: number; readonly sha256: string }> {
  handle.offset = 0;
  const hasher = new Sha256();
  let fileSize = 0;
  let bytesSinceYield = 0;

  while (true) {
    const chunk = handle.readBytes(HASH_READ_CHUNK_BYTES);
    if (chunk.byteLength === 0) break;
    hasher.update(chunk);
    fileSize += chunk.byteLength;
    bytesSinceYield += chunk.byteLength;
    if (totalSize > 0) {
      onProgress?.(Math.min(fileSize / totalSize, 1));
    }
    if (bytesSinceYield >= YIELD_INTERVAL_BYTES) {
      bytesSinceYield = 0;
      await yieldToEventLoop();
    }
  }

  return { fileSize, sha256: hasher.digestHex() };
}

/**
 * Extracts entries one by one directly from a seekable ZIP handle so peak JS
 * memory stays proportional to a single entry instead of the whole archive.
 */
async function extractEntriesFromStream(
  reader: SeekableByteReader,
  entries: readonly ZipStreamEntry[],
  entriesDirectory: Directory,
  onProgress?: BookImportProgressHandler,
): Promise<readonly ManagedBookAsset[]> {
  const result: ManagedBookAsset[] = [];
  const createdDirectories = new Set<string>();
  const totalEntries = Math.max(entries.length, 1);
  let processed = 0;
  let bytesSinceYield = 0;

  for (const entry of entries) {
    const bytes = readZipEntryBytes(reader, entry, MAX_ENTRY_UNCOMPRESSED_BYTES);
    const uri = writeExtractedEntry(entriesDirectory, entry.path, bytes, createdDirectories);
    const sha256 = await sha256HexAsync(bytes);
    result.push({
      path: entry.path,
      uri,
      byteSize: bytes.byteLength,
      sha256,
    });
    processed += 1;
    bytesSinceYield += bytes.byteLength;
    onProgress?.(processed / totalEntries);

    if (processed % WRITE_YIELD_EVERY_ENTRIES === 0 || bytesSinceYield >= YIELD_INTERVAL_BYTES) {
      bytesSinceYield = 0;
      await yieldToEventLoop();
    }
  }

  return result;
}

/**
 * Fallback central directory inspection for ZIP64 or non-seekable archives.
 */
function inspectArchiveEntries(sourceBytes: Uint8Array): ArchiveInspection {
  const entriesByPath = new Map<string, ArchiveEntryDescriptor>();
  let totalRawEntries = 0;
  let totalBytes = 0;
  let allStored = true;
  let hasDirectoryEntry = false;
  let hasUnnormalizedPath = false;
  let hasDuplicatePath = false;
  let hasMimetype = false;
  let firstEntryPath: string | undefined;

  unzipSync(sourceBytes, {
    filter: (entry) => {
      totalRawEntries += 1;
      if (totalRawEntries > MAX_ENTRIES) {
        throw new Error('The EPUB archive contains too many entries.');
      }
      const path = normalizeZipEntryPath(entry.name);
      if (!path || entry.name.endsWith('/')) {
        hasDirectoryEntry = true;
        return false;
      }
      if (entry.originalSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
        throw new Error(`The EPUB entry ${path} exceeds the size limit.`);
      }
      totalBytes += entry.originalSize;
      if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('The EPUB archive expands beyond the size limit.');
      }
      if (entry.compression !== 0) {
        allStored = false;
      }
      if (entry.name !== path) {
        hasUnnormalizedPath = true;
      }
      if (firstEntryPath === undefined) {
        firstEntryPath = path;
      }
      if (path === 'mimetype') {
        hasMimetype = true;
      }
      if (entriesByPath.has(path)) {
        hasDuplicatePath = true;
      }
      entriesByPath.set(path, { rawPath: entry.name, path, originalSize: entry.originalSize });
      return false;
    },
  });

  const isAlreadyStoreArchive =
    allStored &&
    !hasDirectoryEntry &&
    !hasUnnormalizedPath &&
    !hasDuplicatePath &&
    (!hasMimetype || firstEntryPath === 'mimetype');

  return { entries: [...entriesByPath.values()], isAlreadyStoreArchive };
}

/**
 * Fallback extraction for ZIP64 or non-seekable archives: extracts in bounded
 * uncompressed-byte batches so large illustrated EPUBs avoid holding an entire
 * decompressed copy in JS memory at once.
 */
async function extractEntriesInBatches(
  sourceBytes: Uint8Array,
  entries: readonly ArchiveEntryDescriptor[],
  entriesDirectory: Directory,
  onProgress?: BookImportProgressHandler,
): Promise<readonly ManagedBookAsset[]> {
  const result: ManagedBookAsset[] = [];
  const createdDirectories = new Set<string>();
  const totalEntries = Math.max(entries.length, 1);
  let processed = 0;

  for (const batch of planExtractionBatches(entries)) {
    const wanted = new Set(batch.map((entry) => entry.rawPath));
    const extracted = unzipSync(sourceBytes, {
      filter: (entry) => wanted.has(entry.name),
    });

    for (const descriptor of batch) {
      const bytes = extracted[descriptor.rawPath];
      delete extracted[descriptor.rawPath];
      if (!bytes) {
        throw new Error(`The EPUB entry ${descriptor.path} could not be extracted.`);
      }
      if (bytes.byteLength > MAX_ENTRY_UNCOMPRESSED_BYTES) {
        throw new Error(`The EPUB entry ${descriptor.path} exceeds the size limit.`);
      }

      const uri = writeExtractedEntry(entriesDirectory, descriptor.path, bytes, createdDirectories);
      const sha256 = await sha256HexAsync(bytes);
      result.push({
        path: descriptor.path,
        uri,
        byteSize: bytes.byteLength,
        sha256,
      });
      processed += 1;
      onProgress?.(processed / totalEntries);
    }

    await yieldToEventLoop();
  }

  return result;
}

function planExtractionBatches(entries: readonly ArchiveEntryDescriptor[]): ArchiveEntryDescriptor[][] {
  const batches: ArchiveEntryDescriptor[][] = [];
  let current: ArchiveEntryDescriptor[] = [];
  let currentBytes = 0;

  for (const entry of entries) {
    if (
      current.length > 0 &&
      (current.length >= MAX_EXTRACTION_BATCH_ENTRIES || currentBytes + entry.originalSize > MAX_EXTRACTION_BATCH_BYTES)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(entry);
    currentBytes += entry.originalSize;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

function writeExtractedEntry(
  entriesDirectory: Directory,
  entryPath: string,
  bytes: Uint8Array,
  createdDirectories: Set<string>,
): string {
  const parts = entryPath.split('/');
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error(`The EPUB entry path is invalid: ${entryPath}`);
  }

  let parentDirectory: Directory | undefined;
  let file: File | undefined;
  try {
    if (parts.length > 0) {
      const relativeDir = parts.join('/');
      parentDirectory = new Directory(entriesDirectory, ...parts);
      if (!createdDirectories.has(relativeDir)) {
        parentDirectory.create({ intermediates: true, idempotent: true });
        createdDirectories.add(relativeDir);
      }
      file = new File(parentDirectory, fileName);
    } else {
      file = new File(entriesDirectory, fileName);
    }
    writeFileBytes(file, bytes);
    return file.uri;
  } finally {
    releaseSharedObject(file);
    releaseSharedObject(parentDirectory);
  }
}

async function repackStoreEpub(
  target: File,
  assets: readonly ManagedBookAsset[],
  onProgress?: BookImportProgressHandler,
): Promise<void> {
  target.create({ intermediates: true, overwrite: true });
  const handle = target.open(FileMode.Truncate);
  try {
    await writeStoreZip(
      assets.map((asset) => ({
        path: asset.path,
        readBytes: async () => {
          const entryFile = new File(asset.uri);
          try {
            return await entryFile.bytes();
          } finally {
            releaseSharedObject(entryFile);
          }
        },
      })),
      (chunk) => {
        handle.writeBytes(chunk);
      },
      async (completed, total) => {
        onProgress?.(completed / Math.max(total, 1));
        if (completed % WRITE_YIELD_EVERY_ENTRIES === 0) {
          await yieldToEventLoop();
        }
      },
    );
  } finally {
    closeFileHandle(handle);
  }
}

function assertEpubFileName(fileName: string): void {
  if (!fileName.toLocaleLowerCase().endsWith('.epub')) {
    throw new TypeError('Only EPUB files can be imported.');
  }
}

function sanitizeCoverExtension(extension: string): string {
  const normalized = extension.toLocaleLowerCase().replace(/[^a-z\d]/g, '');
  return /^(?:avif|bmp|gif|ico|img|jpg|png|svg|tif|tiff|webp)$/.test(normalized) ? normalized : 'img';
}
