import { createHash } from 'node:crypto';

import { strToU8, unzipSync, zipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExpoBookFileService } from '../../src/features/library/infrastructure/expo-book-file-service';

const storage = vi.hoisted(() => ({
  files: new Map<string, Uint8Array<ArrayBuffer>>(),
  directories: new Set<string>(),
  sizes: new Map<string, number>(),
  reads: [] as string[],
  beforeWrite: undefined as ((uri: string) => void) | undefined,
  failMove: false,
}));

vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: async (_algorithm: string, bytes: Uint8Array) => {
      const result = createHash('sha256').update(bytes).digest();
      return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
    },
    randomUUID: () => 'test-uuid',
  };
});

vi.mock('expo-file-system', () => {
  const join = (parts: (string | { uri: string })[]) =>
    parts.reduce<string>((uri, part) => {
      const value = typeof part === 'string' ? part : part.uri;
      return uri ? `${uri.replace(/\/$/, '')}/${value.replace(/^\/+/, '')}` : value;
    }, '');
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get exists() {
      return storage.directories.has(this.uri);
    }
    create() {
      storage.directories.add(this.uri);
    }
    delete() {
      for (const uri of storage.files.keys()) {
        if (uri.startsWith(`${this.uri}/`)) storage.files.delete(uri);
      }
      for (const uri of storage.directories) {
        if (uri === this.uri || uri.startsWith(`${this.uri}/`)) storage.directories.delete(uri);
      }
    }
  }
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get exists() {
      return storage.files.has(this.uri);
    }
    get size() {
      return storage.sizes.get(this.uri) ?? storage.files.get(this.uri)?.byteLength ?? 0;
    }
    get parentDirectory() {
      return new Directory(this.uri.slice(0, this.uri.lastIndexOf('/')));
    }
    async arrayBuffer() {
      storage.reads.push(this.uri);
      const bytes = storage.files.get(this.uri);
      if (!bytes) throw new Error('Missing file');
      return bytes.slice().buffer;
    }
    create() {
      storage.files.set(this.uri, new Uint8Array());
    }
    write(bytes: Uint8Array) {
      storage.beforeWrite?.(this.uri);
      storage.files.set(this.uri, bytes.slice());
    }
    async move(target: File) {
      if (storage.failMove) throw new Error('Move failed');
      const bytes = storage.files.get(this.uri);
      if (!bytes) throw new Error('Missing temporary archive');
      storage.files.set(target.uri, bytes);
      storage.files.delete(this.uri);
      this.uri = target.uri;
    }
    delete() {
      storage.files.delete(this.uri);
    }
  }
  return { File, Directory, Paths: { document: 'file:///documents' } };
});

// Keep native rendering modules out of this file-system adapter test.
vi.mock('../../src/reader', () => import('../../src/reader/rito/epub-archive'));

const sourceUri = 'file:///cache/input.epub';
const entries = {
  mimetype: strToU8('application/epub+zip'),
  'OPS/正文.xhtml': strToU8('<html><body>原始正文</body></html>'),
  'OPS/image.png': new Uint8Array([137, 80, 78, 71, 0, 255]),
};
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

beforeEach(() => {
  storage.files.clear();
  storage.directories.clear();
  storage.sizes.clear();
  storage.reads.length = 0;
  storage.beforeWrite = undefined;
  storage.failMove = false;
});

describe('ExpoBookFileService import', () => {
  it('preserves original archive bytes and publishes every extracted asset with its digest', async () => {
    const archive = zipSync(entries);
    storage.files.set(sourceUri, archive);
    const progress: number[] = [];
    const book = await new ExpoBookFileService().importEpub(sourceUri, 'input.epub', (value) => progress.push(value));

    expect(book.sha256).toBe(hash(archive));
    expect(book.bookId).toBe(book.sha256);
    expect(book.fileSize).toBe(archive.byteLength);
    expect(storage.files.get(book.uri)).toEqual(archive);
    expect(book.assets).toHaveLength(Object.keys(entries).length);
    for (const asset of book.assets!) {
      const expected = entries[asset.path as keyof typeof entries];
      expect(storage.files.get(asset.uri)).toEqual(expected);
      expect(asset.sha256).toBe(hash(expected));
      expect(asset.byteSize).toBe(expected.byteLength);
    }
    expect([...storage.files.keys()].some((uri) => uri.includes('import-test-uuid'))).toBe(false);
    expect(progress).toEqual([...progress].sort((left, right) => left - right));
    expect(progress.at(-1)).toBe(0.9);
  });

  it('saves the hashed snapshot if the external file changes during asynchronous extraction', async () => {
    const original = zipSync(entries);
    storage.files.set(sourceUri, original);
    storage.beforeWrite = (uri) => {
      if (uri.includes('/entries/')) storage.files.set(sourceUri, strToU8('external replacement'));
    };
    const book = await new ExpoBookFileService().importEpub(sourceUri, 'input.epub');

    expect(hash(storage.files.get(book.uri)!)).toBe(book.sha256);
    expect(storage.files.get(book.uri)).toEqual(original);
  });

  it('canonicalizes legacy backslash paths while retaining the source identity', async () => {
    const legacy = { mimetype: entries.mimetype, 'OPS\\正文.xhtml': entries['OPS/正文.xhtml'] };
    const archive = zipSync(legacy);
    storage.files.set(sourceUri, archive);
    const book = await new ExpoBookFileService().importEpub(sourceUri, 'legacy.epub');

    expect(book.sha256).toBe(hash(archive));
    expect(unzipSync(storage.files.get(book.uri)!)).toEqual({
      mimetype: entries.mimetype,
      'OPS/正文.xhtml': entries['OPS/正文.xhtml'],
    });
    expect(book.assets?.map((asset) => asset.path)).toEqual(['mimetype', 'OPS/正文.xhtml']);
    expect([...storage.files.keys()].some((uri) => uri.includes('import-test-uuid'))).toBe(false);
  });

  it('cleans a failed new import without deleting its source', async () => {
    storage.files.set(sourceUri, zipSync(entries));
    storage.beforeWrite = () => {
      throw new Error('Disk full');
    };
    await expect(new ExpoBookFileService().importEpub(sourceUri, 'input.epub')).rejects.toThrow('Disk full');
    expect([...storage.files.keys()]).toEqual([sourceUri]);
    expect([...storage.directories]).toEqual(['file:///documents/books']);
  });

  it('keeps an existing managed archive when resource extraction fails', async () => {
    const archive = zipSync(entries);
    const target = `file:///documents/books/${hash(archive)}/book.epub`;
    const previous = strToU8('previous archive');
    storage.files.set(sourceUri, archive);
    storage.files.set(target, previous);
    storage.beforeWrite = () => {
      throw new Error('Disk full');
    };

    await expect(new ExpoBookFileService().importEpub(sourceUri, 'input.epub')).rejects.toThrow('Disk full');
    expect(storage.files.get(target)).toEqual(previous);
    expect([...storage.files.keys()].some((uri) => uri.includes('import-test-uuid'))).toBe(false);
  });

  it('cleans a new archive if its final move fails', async () => {
    storage.files.set(sourceUri, zipSync(entries));
    storage.failMove = true;
    await expect(new ExpoBookFileService().importEpub(sourceUri, 'input.epub')).rejects.toThrow('Move failed');
    expect([...storage.files.keys()]).toEqual([sourceUri]);
  });

  it('rejects oversized input before reading it into JS memory', async () => {
    storage.files.set(sourceUri, new Uint8Array([0]));
    storage.sizes.set(sourceUri, 100 * 1024 * 1024 + 1);

    await expect(new ExpoBookFileService().importEpub(sourceUri, 'large.epub')).rejects.toThrow('byte limit');
    expect(storage.reads).toEqual([]);
    expect(storage.directories.size).toBe(0);
  });
});
