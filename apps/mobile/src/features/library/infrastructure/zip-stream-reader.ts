import { inflateSync, strFromU8 } from 'fflate';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const EOCD_MIN_BYTES = 22;
const EOCD_MAX_SCAN_BYTES = 65_535 + EOCD_MIN_BYTES;
const ZIP_FLAG_ENCRYPTED = 0x0001;
const ZIP_FLAG_UTF8 = 0x0800;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const MAX_ZIP32_U16 = 0xffff;
const MAX_ZIP32_U32 = 0xffffffff;
const READ_CHUNK_BYTES = 512 * 1024;

export interface SeekableByteReader {
  readonly size: number;
  readAt(offset: number, length: number): Uint8Array;
}

export interface ZipStreamLimits {
  readonly maxEntries: number;
  readonly maxEntryUncompressedBytes: number;
  readonly maxTotalUncompressedBytes: number;
}

export interface ZipStreamEntry {
  readonly rawPath: string;
  readonly path: string;
  readonly compression: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

export interface ZipStreamInspection {
  readonly entries: readonly ZipStreamEntry[];
  readonly isAlreadyStoreArchive: boolean;
}

/**
 * Inspects a standard ZIP32 archive's Central Directory via random-access reads
 * without loading the archive body into memory.
 *
 * Returns `null` for ZIP64 archives so callers can fall back to full-buffer parsing.
 */
export function inspectZipStream(reader: SeekableByteReader, limits: ZipStreamLimits): ZipStreamInspection | null {
  const fileSize = reader.size;
  if (fileSize < EOCD_MIN_BYTES) {
    throw new Error('The EPUB archive is not a valid ZIP file.');
  }

  const tailLength = Math.min(fileSize, EOCD_MAX_SCAN_BYTES);
  const tailOffset = fileSize - tailLength;
  const tail = readExact(reader, tailOffset, tailLength);
  const eocdOffset = findEocdOffset(tail);
  if (eocdOffset < 0) {
    throw new Error('The EPUB archive is missing its ZIP central directory.');
  }

  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  const diskNumber = tailView.getUint16(eocdOffset + 4, true);
  const cdDiskNumber = tailView.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = tailView.getUint16(eocdOffset + 8, true);
  const totalEntries = tailView.getUint16(eocdOffset + 10, true);
  const cdSize = tailView.getUint32(eocdOffset + 12, true);
  const cdOffset = tailView.getUint32(eocdOffset + 16, true);

  // Fall back to full-buffer fflate for ZIP64 or split archives.
  if (
    diskNumber === MAX_ZIP32_U16 ||
    cdDiskNumber === MAX_ZIP32_U16 ||
    entriesOnDisk === MAX_ZIP32_U16 ||
    totalEntries === MAX_ZIP32_U16 ||
    cdSize === MAX_ZIP32_U32 ||
    cdOffset === MAX_ZIP32_U32
  ) {
    return null;
  }
  if (diskNumber !== 0 || cdDiskNumber !== 0 || entriesOnDisk !== totalEntries) {
    throw new Error('Multi-disk ZIP archives are not supported.');
  }
  if (totalEntries > limits.maxEntries) {
    throw new Error('The EPUB archive contains too many entries.');
  }
  if (cdOffset + cdSize > fileSize) {
    throw new Error('The EPUB archive central directory is truncated.');
  }

  const cdBytes = readExact(reader, cdOffset, cdSize);
  const cdView = new DataView(cdBytes.buffer, cdBytes.byteOffset, cdBytes.byteLength);

  const entriesByPath = new Map<string, ZipStreamEntry>();
  let cursor = 0;
  let totalRawEntries = 0;
  let totalUncompressedBytes = 0;
  let allStored = true;
  let hasDirectoryEntry = false;
  let hasUnnormalizedPath = false;
  let hasDuplicatePath = false;
  let hasMimetype = false;
  let firstEntryPath: string | undefined;

  while (cursor < cdBytes.byteLength && totalRawEntries < totalEntries) {
    if (cursor + 46 > cdBytes.byteLength) {
      throw new Error('The EPUB archive central directory entry is truncated.');
    }
    if (cdView.getUint32(cursor, true) !== CENTRAL_DIRECTORY_HEADER_SIGNATURE) {
      throw new Error('The EPUB archive central directory is corrupted.');
    }

    totalRawEntries += 1;
    if (totalRawEntries > limits.maxEntries) {
      throw new Error('The EPUB archive contains too many entries.');
    }

    const flags = cdView.getUint16(cursor + 8, true);
    const compression = cdView.getUint16(cursor + 10, true);
    const compressedSize = cdView.getUint32(cursor + 20, true);
    const uncompressedSize = cdView.getUint32(cursor + 24, true);
    const nameLength = cdView.getUint16(cursor + 28, true);
    const extraLength = cdView.getUint16(cursor + 30, true);
    const commentLength = cdView.getUint16(cursor + 32, true);
    const localHeaderOffset = cdView.getUint32(cursor + 42, true);

    const recordEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > cdBytes.byteLength) {
      throw new Error('The EPUB archive central directory entry extends past EOF.');
    }

    if (compressedSize === MAX_ZIP32_U32 || uncompressedSize === MAX_ZIP32_U32 || localHeaderOffset === MAX_ZIP32_U32) {
      return null;
    }

    const rawPath = strFromU8(cdBytes.subarray(cursor + 46, cursor + 46 + nameLength), (flags & ZIP_FLAG_UTF8) === 0);
    cursor = recordEnd;

    const path = normalizeZipEntryPath(rawPath);
    if (!path || rawPath.endsWith('/')) {
      hasDirectoryEntry = true;
      continue;
    }

    if ((flags & ZIP_FLAG_ENCRYPTED) !== 0) {
      throw new Error(`The EPUB entry ${path} is encrypted and cannot be imported.`);
    }
    if (compression !== ZIP_METHOD_STORE && compression !== ZIP_METHOD_DEFLATE) {
      throw new Error(`The EPUB entry ${path} uses an unsupported ZIP compression method (${compression}).`);
    }
    if (uncompressedSize > limits.maxEntryUncompressedBytes) {
      throw new Error(`The EPUB entry ${path} exceeds the size limit.`);
    }
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw new Error('The EPUB archive expands beyond the size limit.');
    }
    if (compression !== ZIP_METHOD_STORE) {
      allStored = false;
    }
    if (rawPath !== path) {
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

    entriesByPath.set(path, {
      rawPath,
      path,
      compression,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
  }

  const isAlreadyStoreArchive =
    allStored &&
    !hasDirectoryEntry &&
    !hasUnnormalizedPath &&
    !hasDuplicatePath &&
    (!hasMimetype || firstEntryPath === 'mimetype');

  return { entries: [...entriesByPath.values()], isAlreadyStoreArchive };
}

/**
 * Reads and inflates a single entry from a seekable ZIP reader, keeping memory
 * proportional to that entry rather than the entire archive.
 */
export function readZipEntryBytes(
  reader: SeekableByteReader,
  entry: ZipStreamEntry,
  maxEntryUncompressedBytes: number,
): Uint8Array {
  const localHeader = readExact(reader, entry.localHeaderOffset, 30);
  const view = new DataView(localHeader.buffer, localHeader.byteOffset, localHeader.byteLength);
  if (view.getUint32(0, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error(`The EPUB entry ${entry.path} has a corrupted local header.`);
  }
  const localNameLength = view.getUint16(26, true);
  const localExtraLength = view.getUint16(28, true);
  const dataOffset = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;

  if (dataOffset + entry.compressedSize > reader.size) {
    throw new Error(`The EPUB entry ${entry.path} extends past the end of the archive.`);
  }

  const raw = readExact(reader, dataOffset, entry.compressedSize);
  if (entry.compression === ZIP_METHOD_STORE) {
    if (raw.byteLength > maxEntryUncompressedBytes) {
      throw new Error(`The EPUB entry ${entry.path} exceeds the size limit.`);
    }
    return raw;
  }

  const inflated = inflateSync(raw, { out: new Uint8Array(entry.uncompressedSize) });
  if (inflated.byteLength > maxEntryUncompressedBytes) {
    throw new Error(`The EPUB entry ${entry.path} exceeds the size limit.`);
  }
  return inflated;
}

export function normalizeZipEntryPath(value: string): string {
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

function findEocdOffset(tail: Uint8Array): number {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let offset = tail.byteLength - EOCD_MIN_BYTES; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + EOCD_MIN_BYTES + commentLength === tail.byteLength) {
      return offset;
    }
  }
  return -1;
}

function readExact(reader: SeekableByteReader, offset: number, length: number): Uint8Array {
  if (length === 0) return new Uint8Array(0);
  if (offset < 0 || offset + length > reader.size) {
    throw new Error('Attempted to read past the end of the EPUB archive.');
  }
  if (length <= READ_CHUNK_BYTES) {
    const chunk = reader.readAt(offset, length);
    if (chunk.byteLength !== length) {
      throw new Error('Unexpected end of file while reading the EPUB archive.');
    }
    return chunk;
  }
  const output = new Uint8Array(length);
  let cursor = 0;
  while (cursor < length) {
    const sliceLength = Math.min(READ_CHUNK_BYTES, length - cursor);
    const chunk = reader.readAt(offset + cursor, sliceLength);
    if (chunk.byteLength !== sliceLength) {
      throw new Error('Unexpected end of file while reading the EPUB archive.');
    }
    output.set(chunk, cursor);
    cursor += sliceLength;
  }
  return output;
}
