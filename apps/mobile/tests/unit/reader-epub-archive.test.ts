import { createHash } from 'node:crypto';
import { strFromU8, strToU8, Zip, ZipPassThrough, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { EpubArchive, extractReaderBookEntries } from '../../src/reader/rito/epub-archive';

describe('EPUB entry extraction', () => {
  it('preserves STORE, DEFLATE, Unicode and empty entries without publishing directory records', async () => {
    const bytes = zipSync({
      'OPS/': new Uint8Array(0),
      'OPS/正文.xhtml': [strToU8('正文 and text'), { level: 9 }],
      'OPS/image.bin': [new Uint8Array([0, 255, 1, 128]), { level: 0 }],
      'OPS/empty': new Uint8Array(0),
    });
    const actual = new Map<string, Uint8Array>();
    const progress: number[] = [];
    const result = await extractReaderBookEntries(
      bytes.buffer,
      ({ path, bytes }) => {
        expect(bytes.buffer).toBeInstanceOf(ArrayBuffer);
        actual.set(path, bytes);
      },
      (value) => progress.push(value),
    );
    expect(result.requiresCanonicalArchive).toBe(false);
    expect([...actual.keys()].sort()).toEqual(['OPS/empty', 'OPS/image.bin', 'OPS/正文.xhtml']);
    expect(strFromU8(actual.get('OPS/正文.xhtml')!)).toBe('正文 and text');
    expect(actual.get('OPS/image.bin')).toEqual(new Uint8Array([0, 255, 1, 128]));
    expect(actual.get('OPS/empty')).toHaveLength(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((value, index) => value >= (progress[index - 1] ?? 0))).toBe(true);
  });

  it('yields to a timer before a large entry has finished', async () => {
    const data = new Uint8Array(1024 * 1024);
    for (let index = 0; index < data.length; index++) data[index] = index % 251;
    const bytes = zipSync({ 'large.bin': [data, { level: 0 }] });
    let timerRan = false;
    const timer = setTimeout(() => {
      timerRan = true;
    }, 0);
    try {
      await extractReaderBookEntries(bytes.buffer, (entry) => {
        expect(timerRan).toBe(true);
        expect(createHash('sha256').update(entry.bytes).digest('hex')).toBe(
          createHash('sha256').update(data).digest('hex'),
        );
      });
    } finally {
      clearTimeout(timer);
    }
  });

  it('supports streamed data descriptors', async () => {
    const bytes = streamedZip([
      ['one.txt', strToU8('one')],
      ['two.txt', strToU8('two')],
    ]);
    const archive = new EpubArchive(bytes);
    expect(strFromU8((await archive.readAsync('two.txt'))!)).toBe('two');
    expect(archive.read('one.txt')).toEqual(strToU8('one'));
  });

  it('does not inflate unrequested damaged resources', async () => {
    const bytes = zipSync({ wanted: strToU8('wanted'), damaged: new Uint8Array(1024 * 1024) });
    const view = new DataView(bytes.buffer);
    const header = centralRecords(bytes)[1]!;
    const local = view.getUint32(header + 42, true);
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    bytes[data] = 0x07; // Reserved DEFLATE block type.
    const archive = new EpubArchive(bytes);
    expect(strFromU8((await archive.readAsync('wanted'))!)).toBe('wanted');
    await expect(archive.extract(() => undefined)).rejects.toThrow();
  });

  it('normalizes legacy backslash paths with an explicit repack result', async () => {
    const archive = zipSync({ 'OPS\\book.xhtml': strToU8('book') });
    const entries = new Map<string, Uint8Array>();
    const result = await extractReaderBookEntries(archive.buffer, ({ path, bytes }) => {
      entries.set(path, bytes);
    });
    expect(result.requiresCanonicalArchive).toBe(true);
    expect([...entries.keys()]).toEqual(['OPS/book.xhtml']);
    expect(strFromU8(entries.get('OPS/book.xhtml')!)).toBe('book');
  });

  it('preserves the last central-directory duplicate record', async () => {
    const bytes = streamedZip([
      ['same.txt', strToU8('old')],
      ['same.txt', strToU8('new')],
    ]);
    const entries = new Map<string, Uint8Array>();
    const result = await extractReaderBookEntries(bytes.buffer, ({ path, bytes }) => {
      entries.set(path, bytes);
    });
    expect(result.requiresCanonicalArchive).toBe(true);
    expect(entries.size).toBe(1);
    expect(strFromU8(entries.get('same.txt')!)).toBe('new');
  });

  it('uses the central directory when obsolete local records reuse a name', async () => {
    const duplicate = streamedZip([
      ['same.txt', strToU8('old')],
      ['same.txt', strToU8('new')],
    ]);
    const records = centralRecords(duplicate);
    const end = duplicate.length - 22;
    const directory = new DataView(duplicate.buffer).getUint32(end + 16, true);
    const bytes = concatenate([
      duplicate.subarray(0, directory),
      duplicate.subarray(records[0], records[1]),
      duplicate.subarray(end),
    ]);
    const view = new DataView(bytes.buffer);
    const newEnd = bytes.length - 22;
    view.setUint16(newEnd + 8, 1, true);
    view.setUint16(newEnd + 10, 1, true);
    view.setUint32(newEnd + 12, records[1]! - records[0]!, true);
    const archive = new EpubArchive(bytes);
    expect(archive.requiresCanonicalArchive).toBe(false);
    const entries = new Map<string, Uint8Array>();
    const result = await archive.extract(({ path, bytes }) => {
      entries.set(path, bytes);
    });
    expect(result.requiresCanonicalArchive).toBe(true);
    expect(strFromU8(entries.get('same.txt')!)).toBe('old');
  });

  it('supports a descriptor signature occurring inside a stored file', async () => {
    const data = concatenate([
      strToU8('prefix'),
      new Uint8Array([80, 75, 7, 8, 0, 0, 0, 0, 0, 0, 0, 0]),
      strToU8('suffix'),
    ]);
    const bytes = streamedZip([['data.bin', data]]);
    const archive = new EpubArchive(bytes);
    expect(await archive.readAsync('data.bin')).toEqual(data);
  });

  it.each(['../outside', '/absolute', 'OPS/../outside', 'OPS/./text', 'bad\0name'])(
    'rejects unsafe path %j',
    (name) => {
      const bytes = zipSync({ [name]: strToU8('data') });
      expect(() => new EpubArchive(bytes)).toThrow('path is invalid');
    },
  );

  it('rejects conflicting normalized names', () => {
    const bytes = zipSync({ 'OPS/text': strToU8('one'), 'OPS\\text': strToU8('two') });
    expect(() => new EpubArchive(bytes)).toThrow('conflicting entry paths');
  });

  it('checks declared entry and total limits before inflation', () => {
    const one = zipSync({ entry: strToU8('small') });
    new DataView(one.buffer).setUint32(centralRecords(one)[0]! + 24, 64 * 1024 * 1024 + 1, true);
    expect(() => new EpubArchive(one)).toThrow('size limit');
    const many = zipSync({ a: strToU8('a'), b: strToU8('b'), c: strToU8('c'), d: strToU8('d') });
    const view = new DataView(many.buffer);
    for (const header of centralRecords(many)) view.setUint32(header + 24, 64 * 1024 * 1024, true);
    expect(() => new EpubArchive(many)).toThrow('expands beyond');
  });

  it('rejects a size disagreement rather than publishing truncated bytes', async () => {
    const bytes = zipSync({ entry: [strToU8('value'), { level: 0 }] });
    new DataView(bytes.buffer).setUint32(centralRecords(bytes)[0]! + 24, 6, true);
    await expect(new EpubArchive(bytes).extract(() => undefined)).rejects.toThrow('invalid uncompressed size');
  });

  it('stops when the resource writer rejects', async () => {
    const bytes = zipSync({ one: [new Uint8Array(256 * 1024), { level: 0 }], two: strToU8('two') });
    const paths: string[] = [];
    await expect(
      new EpubArchive(bytes).extract(({ path }) => {
        paths.push(path);
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    expect(paths).toEqual(['one']);
  });
});

function streamedZip(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  for (const [name, bytes] of entries) {
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    entry.push(bytes, true);
  }
  zip.end();
  return concatenate(chunks);
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function centralRecords(bytes: Uint8Array<ArrayBuffer>): number[] {
  const view = new DataView(bytes.buffer);
  const end = bytes.length - 22;
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const records: number[] = [];
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50);
    records.push(offset);
    offset +=
      46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return records;
}
