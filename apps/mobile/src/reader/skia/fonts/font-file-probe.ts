/**
 * Reads just enough of a font file to reject the shapes the reader kernel
 * cannot use. Rito's pinned font policy refuses variable faces and only ever
 * decodes face 0, so both must be caught before a book is opened with them.
 */
export interface ReaderFontFileProbe {
  /** Family name from the `name` table, when the file carries a readable one. */
  readonly family?: string;
  /**
   * The file carries an sfnt table directory. Both engines need one, and the
   * wrappers that lack it — WOFF and WOFF2 — are otherwise indistinguishable
   * from a usable font by these flags alone, so this has to be checked
   * explicitly rather than inferred from the absent rejections.
   */
  readonly sfnt: boolean;
  /** A variable face; Rito's pinned font policy rejects these outright. */
  readonly variable: boolean;
  /** A font collection; Rito would silently measure only face 0. */
  readonly collection: boolean;
}

const SFNT_VERSIONS = new Set([
  0x00010000, // TrueType outlines
  0x4f54544f, // 'OTTO' — CFF outlines
  0x74727565, // 'true'
  0x74797031, // 'typ1'
]);

const COLLECTION_TAG = 0x74746366; // 'ttcf'
const NAME_TABLE = 0x6e616d65; // 'name'
const VARIATION_TABLE = 0x66766172; // 'fvar'

const NAME_DIRECTORY_BYTES = 12;
const TABLE_RECORD_BYTES = 16;
const TABLE_DIRECTORY_OFFSET = 12;

const NAME_ID_TYPOGRAPHIC_FAMILY = 16;
const NAME_ID_FAMILY = 1;

/** Windows and Unicode platforms both encode `name` strings as UTF-16BE. */
const PLATFORM_WINDOWS = 3;
const PLATFORM_UNICODE = 0;

export function probeReaderFontFile(bytes: Uint8Array): ReaderFontFileProbe {
  if (bytes.byteLength < TABLE_DIRECTORY_OFFSET) {
    return { sfnt: false, variable: false, collection: false };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0, false);
  if (version === COLLECTION_TAG) {
    return { sfnt: false, variable: false, collection: true };
  }
  if (!SFNT_VERSIONS.has(version)) {
    return { sfnt: false, variable: false, collection: false };
  }

  const tables = readTableDirectory(view);
  const nameTable = tables.get(NAME_TABLE);
  return {
    sfnt: true,
    variable: tables.has(VARIATION_TABLE),
    collection: false,
    family: nameTable === undefined ? undefined : readFamilyName(bytes, view, nameTable),
  };
}

/** Tag to byte offset for every table the file declares. */
function readTableDirectory(view: DataView): Map<number, number> {
  const tables = new Map<number, number>();
  const count = view.getUint16(4, false);
  for (let index = 0; index < count; index += 1) {
    const record = TABLE_DIRECTORY_OFFSET + index * TABLE_RECORD_BYTES;
    if (record + TABLE_RECORD_BYTES > view.byteLength) {
      break;
    }
    tables.set(view.getUint32(record, false), view.getUint32(record + 8, false));
  }
  return tables;
}

function readFamilyName(bytes: Uint8Array, view: DataView, tableOffset: number): string | undefined {
  if (tableOffset + 6 > view.byteLength) {
    return undefined;
  }
  const count = view.getUint16(tableOffset + 2, false);
  const storageOffset = tableOffset + view.getUint16(tableOffset + 4, false);
  if (storageOffset > view.byteLength) {
    return undefined;
  }

  let fallback: string | undefined;
  for (let index = 0; index < count; index += 1) {
    const record = tableOffset + 6 + index * NAME_DIRECTORY_BYTES;
    if (record + NAME_DIRECTORY_BYTES > view.byteLength) {
      break;
    }
    const platform = view.getUint16(record, false);
    if (platform !== PLATFORM_WINDOWS && platform !== PLATFORM_UNICODE) {
      continue;
    }
    const nameId = view.getUint16(record + 6, false);
    if (nameId !== NAME_ID_TYPOGRAPHIC_FAMILY && nameId !== NAME_ID_FAMILY) {
      continue;
    }
    const length = view.getUint16(record + 8, false);
    const start = storageOffset + view.getUint16(record + 10, false);
    if (start + length > bytes.byteLength) {
      continue;
    }
    const name = decodeUtf16Be(bytes, start, length);
    if (!name) {
      continue;
    }
    if (nameId === NAME_ID_TYPOGRAPHIC_FAMILY) {
      return name;
    }
    fallback ??= name;
  }
  return fallback;
}

function decodeUtf16Be(bytes: Uint8Array, start: number, length: number): string {
  let name = '';
  for (let index = 0; index + 1 < length; index += 2) {
    const code = (bytes[start + index]! << 8) | bytes[start + index + 1]!;
    if (code !== 0) {
      name += String.fromCharCode(code);
    }
  }
  return name.replace(CONTROL_CHARACTERS, '').trim();
}

const CONTROL_CHARACTERS = new RegExp('[\u0000-\u001f\u007f]', 'g');
