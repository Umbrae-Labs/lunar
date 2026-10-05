import { describe, expect, it } from 'vitest';

import { probeReaderFontFile } from '../../src/reader/skia/fonts/font-file-probe';

const VERSION_TRUETYPE = 0x00010000;
const VERSION_CFF = 0x4f54544f; // 'OTTO'
const VERSION_COLLECTION = 0x74746366; // 'ttcf'
const VERSION_WOFF2 = 0x774f4632; // 'wOF2'

const TAG_NAME = 0x6e616d65;
const TAG_VARIATION = 0x66766172;
const TAG_GLYF = 0x676c7966;

describe('reader font file probe', () => {
  it('accepts both outline flavours and reads no family without a name table', () => {
    const trueType = probeReaderFontFile(buildFont(VERSION_TRUETYPE, [TAG_GLYF]));
    expect(trueType.sfnt).toBe(true);
    expect(trueType.family).toBeUndefined();

    expect(probeReaderFontFile(buildFont(VERSION_CFF, [TAG_GLYF])).sfnt).toBe(true);
  });

  it('prefers the typographic family over the legacy name', () => {
    const probe = probeReaderFontFile(
      buildFont(VERSION_TRUETYPE, [TAG_NAME], [
        { nameId: 1, platform: 3, text: 'Legacy Name' },
        { nameId: 16, platform: 3, text: 'Typographic Name' },
      ]),
    );

    expect(probe.family).toBe('Typographic Name');
  });

  it('falls back to the legacy family when there is no typographic one', () => {
    const probe = probeReaderFontFile(
      buildFont(VERSION_TRUETYPE, [TAG_NAME], [
        { nameId: 1, platform: 1, text: 'Mac Only' },
        { nameId: 1, platform: 3, text: 'Windows Name' },
      ]),
    );

    // The Macintosh platform encodes `name` strings as single bytes, which this
    // reader decodes as UTF-16BE and would render as garbage.
    expect(probe.family).toBe('Windows Name');
  });

  it('flags a variable face', () => {
    const probe = probeReaderFontFile(
      buildFont(VERSION_TRUETYPE, [TAG_GLYF, TAG_VARIATION]),
    );

    expect(probe.sfnt).toBe(true);
    expect(probe.variable).toBe(true);
  });

  it('flags a collection, which Rito would measure as face 0 alone', () => {
    const probe = probeReaderFontFile(buildFont(VERSION_COLLECTION, [TAG_GLYF]));

    expect(probe.collection).toBe(true);
    expect(probe.sfnt).toBe(false);
  });

  // The failure this guards against is silent: a WOFF2 file has no table
  // directory, so every other flag reads as "plain usable font" and the import
  // only fails later, when a book refuses to open.
  it('rejects a WOFF2 wrapper that carries no table directory', () => {
    const probe = probeReaderFontFile(buildFont(VERSION_WOFF2, [TAG_GLYF]));

    expect(probe.sfnt).toBe(false);
    expect(probe.variable).toBe(false);
  });

  it('rejects bytes too short to hold a directory, without throwing', () => {
    expect(probeReaderFontFile(new Uint8Array([0, 1, 0, 0]))).toEqual({
      sfnt: false,
      variable: false,
      collection: false,
    });
    expect(probeReaderFontFile(new Uint8Array())).toEqual({
      sfnt: false,
      variable: false,
      collection: false,
    });
  });

  it('survives a directory that claims more tables than the file holds', () => {
    const bytes = buildFont(VERSION_TRUETYPE, [TAG_GLYF]);
    new DataView(bytes.buffer).setUint16(4, 4000, false);

    expect(probeReaderFontFile(bytes).sfnt).toBe(true);
  });
});

interface NameRecord {
  readonly nameId: number;
  readonly platform: number;
  readonly text: string;
}

function buildFont(
  version: number,
  tableTags: readonly number[],
  nameRecords?: readonly NameRecord[],
): Uint8Array {
  const directoryBytes = 12 + tableTags.length * 16;
  const nameTable = nameRecords ? buildNameTable(nameRecords) : new Uint8Array();
  const bytes = new Uint8Array(directoryBytes + nameTable.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, version, false);
  view.setUint16(4, tableTags.length, false);
  tableTags.forEach((tag, index) => {
    const record = 12 + index * 16;
    view.setUint32(record, tag, false);
    // Only the `name` table's contents are ever read; the rest only have to be
    // declared, because `fvar` is detected by tag alone.
    view.setUint32(record + 8, directoryBytes, false);
  });
  bytes.set(nameTable, directoryBytes);
  return bytes;
}

function buildNameTable(records: readonly NameRecord[]): Uint8Array {
  const encoded = records.map((record) => utf16be(record.text));
  const storageOffset = 6 + records.length * 12;
  const bytes = new Uint8Array(
    storageOffset + encoded.reduce((total, entry) => total + entry.byteLength, 0),
  );
  const view = new DataView(bytes.buffer);
  view.setUint16(2, records.length, false);
  view.setUint16(4, storageOffset, false);
  let cursor = storageOffset;
  records.forEach((record, index) => {
    const entry = encoded[index]!;
    const at = 6 + index * 12;
    view.setUint16(at, record.platform, false);
    view.setUint16(at + 6, record.nameId, false);
    view.setUint16(at + 8, entry.byteLength, false);
    view.setUint16(at + 10, cursor - storageOffset, false);
    bytes.set(entry, cursor);
    cursor += entry.byteLength;
  });
  return bytes;
}

function utf16be(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[index * 2] = code >> 8;
    bytes[index * 2 + 1] = code & 0xff;
  }
  return bytes;
}
