import { Unzip, UnzipInflate, unzipSync, type UnzipFileInfo } from 'fflate';

import type { ReaderBookEntry, ReaderBookExtractionResult } from '../contracts';

export const READER_EPUB_MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 5_000;
const INPUT_CHUNK_BYTES = 64 * 1024;
const YIELD_AFTER_BYTES = 128 * 1024;
const YIELD_AFTER_MS = 16;
const SMALL_READ_BYTES = 128 * 1024;

interface ArchiveEntry extends UnzipFileInfo {
  readonly path: string;
}

class CanonicalArchiveRequired extends Error {}

/** The central directory is authoritative; enumerate it without inflating resources. */
export class EpubArchive {
  readonly entries = new Map<string, ArchiveEntry>();
  readonly bytes: Uint8Array;
  readonly requiresCanonicalArchive: boolean;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (this.bytes.byteLength === 0 || this.bytes.byteLength > READER_EPUB_MAX_ARCHIVE_BYTES) {
      throw new Error('The EPUB archive size is outside the supported range.');
    }
    let count = 0;
    let totalBytes = 0;
    let canonical = false;
    unzipSync(this.bytes, {
      filter: (entry) => {
        if (++count > MAX_ENTRIES) throw new Error('The EPUB archive contains too many entries.');
        const path = normalizeEntryPath(entry.name);
        if (
          !Number.isSafeInteger(entry.originalSize) ||
          entry.originalSize < 0 ||
          entry.originalSize > MAX_ENTRY_BYTES
        ) {
          throw new Error(`The EPUB entry ${path} exceeds the size limit.`);
        }
        totalBytes += entry.originalSize;
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error('The EPUB archive expands beyond the size limit.');
        if (!path || entry.name.replaceAll('\\', '/').endsWith('/')) return false;
        const previous = this.entries.get(path);
        if (previous && previous.name !== entry.name) {
          throw new Error(`The EPUB archive contains conflicting entry paths: ${path}`);
        }
        canonical ||= entry.name !== path || previous !== undefined;
        this.entries.set(path, { ...entry, path });
        return false;
      },
    });
    this.requiresCanonicalArchive = canonical;
  }

  read(path: string): Uint8Array<ArrayBuffer> | undefined {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    const bytes = unzipSync(this.bytes, { filter: (candidate) => candidate.name === entry.name })[entry.name];
    this.assertEntrySize(entry, bytes?.byteLength ?? -1);
    return bytes;
  }

  async readAsync(path: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    const entry = this.entries.get(path);
    if (!entry) return undefined;
    // Container/OPF and small covers need only a central-directory lookup.
    // Do not scan the whole local stream for each tiny metadata document.
    if (entry.size <= SMALL_READ_BYTES && entry.originalSize <= SMALL_READ_BYTES) return this.read(path);
    let result: Uint8Array<ArrayBuffer> | undefined;
    await this.extract(
      ({ bytes }) => {
        result = bytes;
      },
      undefined,
      path,
    );
    return result;
  }

  async extract(
    onEntry: (entry: ReaderBookEntry) => void | Promise<void>,
    onProgress?: (progress: number) => void,
    onlyPath?: string,
  ): Promise<ReaderBookExtractionResult> {
    let lastProgress = 0;
    const report = (value: number) => {
      if (value === 1 || value - lastProgress >= 0.01) {
        lastProgress = Math.max(lastProgress, value);
        onProgress?.(lastProgress);
      }
    };
    const fallback = async () => {
      // Preserve central-directory/last-record semantics for legacy archives.
      // The normal path below never uses full-archive inflation.
      await yieldToEventLoop();
      const data = unzipSync(this.bytes, {
        filter: (entry) => {
          const selected = this.entries.get(normalizeEntryPath(entry.name));
          return !!selected && selected.name === entry.name && (!onlyPath || selected.path === onlyPath);
        },
      });
      let total = 0;
      for (const entry of this.entries.values()) {
        if (onlyPath && entry.path !== onlyPath) continue;
        const bytes = data[entry.name];
        this.assertEntrySize(entry, bytes?.byteLength ?? -1);
        total += bytes.byteLength;
        if (total > MAX_TOTAL_BYTES) throw new Error('The EPUB archive expands beyond the size limit.');
        await onEntry({ path: entry.path, bytes });
        await yieldToEventLoop();
      }
      report(1);
      return { requiresCanonicalArchive: true };
    };
    if (this.requiresCanonicalArchive) return fallback();

    const selectedByName = new Map([...this.entries.values()].map((entry) => [entry.name, entry]));
    const seen = new Set<string>();
    const finished = new Set<string>();
    const completed: ReaderBookEntry[] = [];
    let failure: unknown;
    let total = 0;
    let decodedSinceYield = false;
    const unzipper = new Unzip((file) => {
      if (failure) return;
      const entry = selectedByName.get(file.name);
      // Old local records absent from the current central directory are ignored.
      if (!entry || (onlyPath && entry.path !== onlyPath)) return;
      if (
        seen.has(file.name) ||
        file.compression !== entry.compression ||
        (file.originalSize !== undefined && file.originalSize !== entry.originalSize) ||
        (file.size !== undefined && file.size !== entry.size)
      ) {
        throw new CanonicalArchiveRequired();
      }
      seen.add(file.name);
      let size = 0;
      const chunks: Uint8Array[] = [];
      file.ondata = (error, chunk, final) => {
        if (failure) return;
        if (error) {
          // A descriptor signature may occur inside the payload. In that
          // case the local stream can end early; retry the authoritative
          // central-directory slice rather than rejecting a valid archive.
          failure = file.originalSize === undefined ? new CanonicalArchiveRequired() : error;
          return;
        }
        try {
          size += chunk.byteLength;
          total += chunk.byteLength;
          if (size > entry.originalSize || size > MAX_ENTRY_BYTES) this.assertEntrySize(entry, size);
          if (total > MAX_TOTAL_BYTES) throw new Error('The EPUB archive expands beyond the size limit.');
          if (chunk.byteLength) {
            chunks.push(chunk);
            decodedSinceYield = true;
          }
          if (final) {
            if (size < entry.originalSize && file.originalSize === undefined) throw new CanonicalArchiveRequired();
            this.assertEntrySize(entry, size);
            const bytes = chunks.length === 1 ? chunks[0]!.slice() : joinChunks(chunks, size);
            chunks.length = 0;
            finished.add(file.name);
            completed.push({ path: entry.path, bytes });
          }
        } catch (error) {
          failure = error;
        }
      };
      file.start();
    });
    unzipper.register(UnzipInflate);
    let cpuSinceYield = 0;
    let bytesSinceYield = 0;
    try {
      for (let offset = 0; offset < this.bytes.byteLength; offset += INPUT_CHUNK_BYTES) {
        const end = Math.min(offset + INPUT_CHUNK_BYTES, this.bytes.byteLength);
        const decodeStart = performance.now();
        unzipper.push(this.bytes.subarray(offset, end), end === this.bytes.byteLength);
        cpuSinceYield += performance.now() - decodeStart;
        if (failure) throw failure;
        while (completed.length) await onEntry(completed.shift()!);
        report(end / this.bytes.byteLength);
        bytesSinceYield += end - offset;
        if (decodedSinceYield && (bytesSinceYield >= YIELD_AFTER_BYTES || cpuSinceYield >= YIELD_AFTER_MS)) {
          await yieldToEventLoop();
          // Awaited writers can already yield for native I/O. Their wall
          // time is not decoder CPU and must not trigger an extra timer.
          cpuSinceYield = 0;
          bytesSinceYield = 0;
          decodedSinceYield = false;
        }
      }
      const expected = onlyPath ? 1 : this.entries.size;
      if (finished.size !== expected) throw new Error('The EPUB archive has incomplete local entries.');
      report(1);
      return { requiresCanonicalArchive: false };
    } catch (error) {
      if (error instanceof CanonicalArchiveRequired) return fallback();
      throw error;
    }
  }

  private assertEntrySize(entry: ArchiveEntry, actual: number): void {
    if (actual !== entry.originalSize || actual > MAX_ENTRY_BYTES) {
      throw new Error(`The EPUB entry ${entry.path} has an invalid uncompressed size.`);
    }
  }
}

/**
 * Entries are upserts by path: a central-directory compatibility retry may
 * emit an earlier path again. Callbacks are awaited before more input is fed.
 */
export async function extractReaderBookEntries(
  data: ArrayBuffer,
  onEntry: (entry: ReaderBookEntry) => void | Promise<void>,
  onProgress?: (progress: number) => void,
): Promise<ReaderBookExtractionResult> {
  return new EpubArchive(data).extract(onEntry, onProgress);
}

function normalizeEntryPath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.includes('\0'))
    throw new Error(`The EPUB entry path is invalid: ${value}`);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part === '.')) throw new Error(`The EPUB entry path is invalid: ${value}`);
  return parts.join('/');
}

function joinChunks(chunks: readonly Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
