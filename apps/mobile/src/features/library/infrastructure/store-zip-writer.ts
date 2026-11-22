import { strToU8 } from 'fflate';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION_20 = 20;
const ZIP_FLAG_UTF8 = 0x0800;
const DOS_DEFAULT_DATE = 0x0021; // 1980-01-01
const MAX_ZIP32_OFFSET = 0xffffffff;
const MAX_ZIP32_ENTRIES = 0xffff;
const WRITE_CHUNK_BYTES = 512 * 1024;

const CRC32_TABLE = buildCrc32Table();

interface CentralDirectoryRecord {
  readonly nameBytes: Uint8Array;
  readonly flags: number;
  readonly crc: number;
  readonly size: number;
  readonly localHeaderOffset: number;
}

export interface StoreZipEntrySource {
  readonly path: string;
  readBytes(): Promise<Uint8Array>;
}

/**
 * Streams a STORE-only ZIP archive one entry at a time through `writeChunk`,
 * keeping peak memory proportional to a single entry rather than the whole book.
 * Entries are written without data descriptors so `mimetype` starts at offset 38.
 */
export async function writeStoreZip(
  entries: readonly StoreZipEntrySource[],
  writeChunk: (chunk: Uint8Array) => void | Promise<void>,
  onEntryWritten?: (completed: number, total: number) => void | Promise<void>,
): Promise<void> {
  if (entries.length > MAX_ZIP32_ENTRIES) {
    throw new RangeError('Too many entries for a standard ZIP archive.');
  }

  const ordered = entries
    .slice()
    .sort((left, right) =>
      left.path === 'mimetype' ? -1 : right.path === 'mimetype' ? 1 : left.path.localeCompare(right.path),
    );
  const centralRecords: CentralDirectoryRecord[] = [];
  let offset = 0;

  for (const [index, entry] of ordered.entries()) {
    const nameBytes = strToU8(entry.path);
    if (nameBytes.byteLength > 0xffff) {
      throw new RangeError(`The ZIP entry name is too long: ${entry.path}`);
    }
    const flags = nameBytes.byteLength !== entry.path.length ? ZIP_FLAG_UTF8 : 0;
    const data = await entry.readBytes();
    const size = data.byteLength;
    const nextOffset = offset + 30 + nameBytes.byteLength + size;
    if (nextOffset > MAX_ZIP32_OFFSET) {
      throw new RangeError('The ZIP archive exceeds the 4 GiB limit.');
    }

    const crc = computeCrc32(data);
    const header = new Uint8Array(30 + nameBytes.byteLength);
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    view.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
    view.setUint16(4, ZIP_VERSION_20, true);
    view.setUint16(6, flags, true);
    view.setUint16(8, 0, true); // STORE
    view.setUint16(10, 0, true);
    view.setUint16(12, DOS_DEFAULT_DATE, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameBytes.byteLength, true);
    view.setUint16(28, 0, true);
    header.set(nameBytes, 30);

    await writeChunk(header);
    for (let position = 0; position < size; position += WRITE_CHUNK_BYTES) {
      const end = Math.min(position + WRITE_CHUNK_BYTES, size);
      await writeChunk(position === 0 && end === size ? data : data.subarray(position, end));
    }

    centralRecords.push({ nameBytes, flags, crc, size, localHeaderOffset: offset });
    offset = nextOffset;
    await onEntryWritten?.(index + 1, ordered.length);
  }

  let centralDirectorySize = 0;
  for (const record of centralRecords) {
    centralDirectorySize += 46 + record.nameBytes.byteLength;
  }
  const centralDirectory = new Uint8Array(centralDirectorySize + 22);
  const view = new DataView(centralDirectory.buffer, centralDirectory.byteOffset, centralDirectory.byteLength);
  let cursor = 0;

  for (const record of centralRecords) {
    view.setUint32(cursor, CENTRAL_DIRECTORY_HEADER_SIGNATURE, true);
    view.setUint16(cursor + 4, ZIP_VERSION_20, true);
    view.setUint16(cursor + 6, ZIP_VERSION_20, true);
    view.setUint16(cursor + 8, record.flags, true);
    view.setUint16(cursor + 10, 0, true); // STORE
    view.setUint16(cursor + 12, 0, true);
    view.setUint16(cursor + 14, DOS_DEFAULT_DATE, true);
    view.setUint32(cursor + 16, record.crc, true);
    view.setUint32(cursor + 20, record.size, true);
    view.setUint32(cursor + 24, record.size, true);
    view.setUint16(cursor + 28, record.nameBytes.byteLength, true);
    view.setUint16(cursor + 30, 0, true);
    view.setUint16(cursor + 32, 0, true);
    view.setUint16(cursor + 34, 0, true);
    view.setUint16(cursor + 36, 0, true);
    view.setUint32(cursor + 38, 0, true);
    view.setUint32(cursor + 42, record.localHeaderOffset, true);
    centralDirectory.set(record.nameBytes, cursor + 46);
    cursor += 46 + record.nameBytes.byteLength;
  }

  view.setUint32(cursor, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(cursor + 4, 0, true);
  view.setUint16(cursor + 6, 0, true);
  view.setUint16(cursor + 8, centralRecords.length, true);
  view.setUint16(cursor + 10, centralRecords.length, true);
  view.setUint32(cursor + 12, centralDirectorySize, true);
  view.setUint32(cursor + 16, offset, true);
  view.setUint16(cursor + 20, 0, true);

  await writeChunk(centralDirectory);
}

export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}
