import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { zipSync } from 'fflate';

import { extractReaderBookEntries, READER_EPUB_MAX_ARCHIVE_BYTES } from '../../../reader';

import type {
  BookFileService,
  BookImportProgressHandler,
  ManagedBookCover,
  ManagedBookFile,
  ManagedBookAsset,
} from '../services/book-file-service';

const EPUB_FILE_NAME = 'book.epub';

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
    assertArchiveSize(source.size);

    const data = await source.arrayBuffer();
    onProgress?.(0.18);
    const fileSize = data.byteLength;
    assertArchiveSize(fileSize);

    const sha256 = bytesToHex(await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(data)));
    onProgress?.(0.28);
    const bookId = sha256;
    const booksDirectory = new Directory(Paths.document, 'books');
    booksDirectory.create({ intermediates: true, idempotent: true });
    const bookDirectory = new Directory(booksDirectory, bookId);
    bookDirectory.create({ intermediates: true, idempotent: true });
    const target = new File(bookDirectory, EPUB_FILE_NAME);
    const hadManagedArchive = target.exists;
    const pending = new File(bookDirectory, `import-${randomUUID()}.epub`);
    onProgress?.(0.36);

    const entriesDirectory = new Directory(bookDirectory, 'entries');
    entriesDirectory.create({ intermediates: true, idempotent: true });
    try {
      const { assets, requiresCanonicalArchive } = await extractEntries(data, entriesDirectory, (progress) => {
        onProgress?.(0.36 + progress * 0.46);
      });
      if (requiresCanonicalArchive) {
        await writeCanonicalArchive(pending, assets);
      } else {
        // Keep the original ZIP and let Rito decode its resources natively.
        // The extracted assets still serve the existing file/plugin contract.
        // Save the same snapshot that was hashed and extracted, even if the
        // external source changes while asynchronous extraction is running.
        pending.create({ intermediates: true, overwrite: true });
        pending.write(new Uint8Array(data));
      }
      await pending.move(target, { overwrite: true });
      onProgress?.(0.9);
      return { bookId, uri: target.uri, fileName, fileSize, sha256, assets };
    } catch (error) {
      try {
        if (pending.exists) pending.delete();
      } catch {
        // Best-effort cleanup of an unpublished archive.
      }
      if (!hadManagedArchive) {
        try {
          bookDirectory.delete();
        } catch {
          // Best-effort cleanup after a failed import.
        }
      }
      throw error;
    }
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
): Promise<{ assets: readonly ManagedBookAsset[]; requiresCanonicalArchive: boolean }> {
  const result = new Map<string, ManagedBookAsset>();
  const extraction = await extractReaderBookEntries(
    data,
    async ({ path, bytes }) => {
      const parts = path.split('/');
      const fileName = parts.pop();
      if (!fileName) throw new Error('The EPUB entry has no file name.');
      let parent = entriesDirectory;
      for (const part of parts) {
        parent = new Directory(parent, part);
        parent.create({ intermediates: true, idempotent: true });
      }
      const file = new File(parent, fileName);
      file.create({ intermediates: true, overwrite: true });
      file.write(bytes);
      const sha256 = bytesToHex(await digest(CryptoDigestAlgorithm.SHA256, bytes));
      result.set(path, { path, uri: file.uri, byteSize: bytes.byteLength, sha256 });
    },
    onProgress,
  );
  return { assets: [...result.values()], requiresCanonicalArchive: extraction.requiresCanonicalArchive };
}

async function writeCanonicalArchive(target: File, assets: readonly ManagedBookAsset[]): Promise<void> {
  // Legacy noncanonical names/duplicate records used to be normalized by
  // repacking. Preserve that compatibility fallback rather than copying them.
  const entries: Record<string, Uint8Array> = Object.create(null);
  for (const asset of assets
    .slice()
    .sort((left, right) =>
      left.path === 'mimetype' ? -1 : right.path === 'mimetype' ? 1 : left.path.localeCompare(right.path),
    )) {
    entries[asset.path] = new Uint8Array(await new File(asset.uri).arrayBuffer());
  }
  target.create({ intermediates: true, overwrite: true });
  target.write(zipSync(entries, { level: 0 }));
}

function assertArchiveSize(size: number): void {
  if (size > READER_EPUB_MAX_ARCHIVE_BYTES) {
    throw new RangeError(`The selected EPUB exceeds the ${READER_EPUB_MAX_ARCHIVE_BYTES} byte limit.`);
  }
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
