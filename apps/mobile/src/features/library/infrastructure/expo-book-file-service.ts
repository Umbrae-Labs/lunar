import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { unzipSync, zipSync } from 'fflate';

import type {
  BookFileService,
  BookImportProgressHandler,
  ManagedBookCover,
  ManagedBookFile,
} from '../services/book-file-service';

const EPUB_FILE_NAME = 'book.epub';
const MAX_EPUB_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 5_000;

export class ExpoBookFileService implements BookFileService {
  async importEpub(
    sourceUri: string,
    fileName: string,
    onProgress?: BookImportProgressHandler,
  ): Promise<ManagedBookFile> {
    onProgress?.(0.04);
    assertEpubFileName(fileName);

    const source = new File(sourceUri);
    if (!source.exists) {
      throw new Error('The selected EPUB file cannot be read.');
    }

    const data = await source.arrayBuffer();
    onProgress?.(0.18);
    const fileSize = data.byteLength;
    if (fileSize > MAX_EPUB_ARCHIVE_BYTES) {
      throw new RangeError(`The selected EPUB exceeds the ${MAX_EPUB_ARCHIVE_BYTES} byte limit.`);
    }

    const sha256 = bytesToHex(await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(data)));
    onProgress?.(0.28);
    const bookId = sha256;
    const booksDirectory = new Directory(Paths.document, 'books');
    booksDirectory.create({ intermediates: true, idempotent: true });
    const bookDirectory = new Directory(booksDirectory, bookId);
    bookDirectory.create({ intermediates: true, idempotent: true });
    const target = new File(bookDirectory, EPUB_FILE_NAME);
    const hadManagedArchive = target.exists;

    if (!target.exists) {
      await source.copy(target);
    }
    onProgress?.(0.36);

    const entriesDirectory = new Directory(bookDirectory, 'entries');
    entriesDirectory.create({ intermediates: true, idempotent: true });
    let entries: Awaited<ReturnType<typeof extractEntries>>;
    try {
      entries = await extractEntries(data, entriesDirectory, (progress) => {
        onProgress?.(0.36 + progress * 0.46);
      });
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

    // Rito still receives a complete EPUB, while all entries are stored with
    // ZIP method STORE. Import performs inflation once; opening the book no
    // longer spends time inflating every requested resource.
    const archiveEntries = Object.fromEntries(
      entries
        .slice()
        .sort((left, right) =>
          left.path === 'mimetype' ? -1 : right.path === 'mimetype' ? 1 : left.path.localeCompare(right.path),
        )
        .map((entry) => [entry.path, entry.bytes]),
    );
    target.write(zipSync(archiveEntries, { level: 0 }));
    onProgress?.(0.9);

    return {
      bookId,
      uri: target.uri,
      fileName,
      fileSize,
      sha256,
      assets: entries.map(({ path, uri, bytes, sha256 }) => ({
        path,
        uri,
        byteSize: bytes.byteLength,
        sha256,
      })),
    };
  }

  async readBook(book: ManagedBookFile): Promise<ArrayBuffer> {
    const file = new File(book.uri);
    if (!file.exists) {
      throw new Error(`Managed EPUB is missing for book ${book.bookId}.`);
    }
    return file.arrayBuffer();
  }

  async saveCover(book: ManagedBookFile, cover: ManagedBookCover): Promise<string> {
    const extension = sanitizeCoverExtension(cover.fileExtension);
    const target = new File(new File(book.uri).parentDirectory, `cover.${extension}`);
    target.create({ intermediates: true, overwrite: true });
    target.write(cover.bytes);
    return target.uri;
  }

  async removeBook(book: ManagedBookFile): Promise<void> {
    const directory = new File(book.uri).parentDirectory;
    if (directory.exists) {
      directory.delete();
    }
  }
}

async function extractEntries(
  data: ArrayBuffer,
  entriesDirectory: Directory,
  onProgress?: BookImportProgressHandler,
): Promise<readonly { path: string; uri: string; bytes: Uint8Array; sha256: string }[]> {
  const archive = unzipSync(new Uint8Array(data));
  const archiveEntries = Object.entries(archive);
  const names = archiveEntries.map(([path]) => path);
  if (names.length > MAX_ENTRIES) throw new Error('The EPUB archive contains too many entries.');
  const result: { path: string; uri: string; bytes: Uint8Array; sha256: string }[] = [];
  let totalBytes = 0;
  const totalEntries = Math.max(archiveEntries.length, 1);
  for (const [index, [rawPath, bytes]] of archiveEntries.entries()) {
    const path = normalizeEntryPath(rawPath);
    if (!path || rawPath.endsWith('/')) {
      onProgress?.((index + 1) / totalEntries);
      continue;
    }
    if (bytes.byteLength > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error(`The EPUB entry ${path} exceeds the size limit.`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('The EPUB archive expands beyond the size limit.');
    }
    const parts = path.split('/');
    const fileName = parts.pop();
    if (!fileName) continue;
    let parent = entriesDirectory;
    for (const part of parts) {
      parent = new Directory(parent, part);
      parent.create({ intermediates: true, idempotent: true });
    }
    const file = new File(parent, fileName);
    file.create({ intermediates: true, overwrite: true });
    file.write(bytes);
    const sha256 = bytesToHex(await digest(CryptoDigestAlgorithm.SHA256, bytes));
    result.push({ path, uri: file.uri, bytes, sha256 });
    onProgress?.((index + 1) / totalEntries);
  }
  return result;
}

function normalizeEntryPath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.includes('\0')) {
    throw new Error(`The EPUB entry path is invalid: ${value}`);
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part === '.')) {
    throw new Error(`The EPUB entry path is invalid: ${value}`);
  }
  return parts.join('/');
}

function assertEpubFileName(fileName: string): void {
  if (!fileName.toLocaleLowerCase().endsWith('.epub')) {
    throw new TypeError('Only EPUB files can be imported.');
  }
}

function bytesToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sanitizeCoverExtension(extension: string): string {
  const normalized = extension.toLocaleLowerCase().replace(/[^a-z\d]/g, '');
  return /^(?:avif|bmp|gif|ico|img|jpg|png|svg|tif|tiff|webp)$/.test(normalized) ? normalized : 'img';
}
