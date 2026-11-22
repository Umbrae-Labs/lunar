import { createHash } from 'node:crypto';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import {
  Sha256,
  sha256Hex,
  sha256HexAsync,
  writeFileBytes,
} from '../../src/features/library/infrastructure/expo-file-io';
import { writeStoreZip } from '../../src/features/library/infrastructure/store-zip-writer';
import {
  inspectZipStream,
  readZipEntryBytes,
  type SeekableByteReader,
} from '../../src/features/library/infrastructure/zip-stream-reader';
import {
  sha256Hex as pluginSha256Hex,
  writeFileBytesAsync,
} from '../../src/features/plugins/infrastructure/expo-plugin-io';
import { inspectReaderBookAssets, inspectReaderBookEntries } from '../../src/reader/rito/epub-inspector';

vi.mock('expo-file-system', () => ({
  FileMode: {
    ReadOnly: 'r',
    WriteOnly: 'w',
    Truncate: 'wt',
  },
}));

function bufferReader(archive: Uint8Array): SeekableByteReader {
  return {
    size: archive.byteLength,
    readAt(offset: number, length: number): Uint8Array {
      return archive.subarray(offset, offset + length);
    },
  };
}

function nodeSha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('pure-JS SHA-256 helpers', () => {
  it('matches Node crypto SHA-256 across empty, block-boundary, and chunked inputs', async () => {
    const samples = [
      new Uint8Array(0),
      strToU8('abc'),
      new Uint8Array(55).fill(0x61),
      new Uint8Array(56).fill(0x62),
      new Uint8Array(63).fill(0x63),
      new Uint8Array(64).fill(0x64),
      new Uint8Array(128).fill(0x65),
      Uint8Array.from({ length: 131_077 }, (_, index) => (index * 31) & 0xff),
    ];

    for (const sample of samples) {
      const expected = nodeSha256(sample);
      expect(sha256Hex(sample)).toBe(expected);
      await expect(sha256HexAsync(sample)).resolves.toBe(expected);
      await expect(pluginSha256Hex(sample)).resolves.toBe(expected);

      // Verify incremental updates across arbitrary chunk boundaries.
      const incremental = new Sha256();
      for (let offset = 0; offset < sample.byteLength; offset += 19) {
        incremental.update(sample.subarray(offset, Math.min(offset + 19, sample.byteLength)));
      }
      expect(incremental.digestHex()).toBe(expected);
    }
  });
});

describe('streaming STORE ZIP writer and reader', () => {
  it('streams a valid STORE EPUB archive with mimetype first and UTF-8 paths', async () => {
    const sourceEntries = new Map<string, Uint8Array>([
      ['OEBPS/text/第一章.xhtml', strToU8('<html><body>你好世界</body></html>')],
      ['mimetype', strToU8('application/epub+zip')],
      ['OEBPS/images/cover.jpg', Uint8Array.from({ length: 4096 }, (_, index) => index & 0xff)],
      ['META-INF/container.xml', strToU8('<container />')],
    ]);

    const chunks: Uint8Array[] = [];
    await writeStoreZip(
      [...sourceEntries.entries()].map(([path, bytes]) => ({
        path,
        readBytes: async () => bytes,
      })),
      (chunk) => {
        chunks.push(chunk.slice());
      },
    );

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const archive = new Uint8Array(totalLength);
    let cursor = 0;
    for (const chunk of chunks) {
      archive.set(chunk, cursor);
      cursor += chunk.byteLength;
    }

    // Readable by fflate.unzipSync and by our seekable ZIP stream reader.
    const unpacked = unzipSync(archive);
    for (const [path, bytes] of sourceEntries) {
      expect(unpacked[path]).toEqual(bytes);
    }

    const inspection = inspectZipStream(bufferReader(archive), {
      maxEntries: 100,
      maxEntryUncompressedBytes: 1024 * 1024,
      maxTotalUncompressedBytes: 10 * 1024 * 1024,
    });
    expect(inspection).not.toBeNull();
    expect(inspection!.isAlreadyStoreArchive).toBe(true);
    expect(inspection!.entries[0]?.path).toBe('mimetype');

    for (const entry of inspection!.entries) {
      const extracted = readZipEntryBytes(bufferReader(archive), entry, 1024 * 1024);
      expect(extracted).toEqual(sourceEntries.get(entry.path));
    }
  });

  it('reads deflated archives one entry at a time and marks them as needing STORE repack', () => {
    const chapterText = '段落内容。'.repeat(2000);
    const archive = zipSync(
      {
        mimetype: [strToU8('application/epub+zip'), { level: 0 }],
        'OEBPS/chapter.xhtml': [strToU8(chapterText), { level: 6 }],
      },
      { level: 6 },
    );

    const reader = bufferReader(archive);
    const inspection = inspectZipStream(reader, {
      maxEntries: 100,
      maxEntryUncompressedBytes: 1024 * 1024,
      maxTotalUncompressedBytes: 10 * 1024 * 1024,
    });
    expect(inspection).not.toBeNull();
    expect(inspection!.isAlreadyStoreArchive).toBe(false);

    const chapterEntry = inspection!.entries.find((entry) => entry.path === 'OEBPS/chapter.xhtml')!;
    const bytes = readZipEntryBytes(reader, chapterEntry, 1024 * 1024);
    expect(strFromU8(bytes)).toBe(chapterText);
  });

  it('rejects archives that exceed entry count or expanded byte limits', () => {
    const archive = zipSync({
      'a.txt': strToU8('1234567890'),
      'b.txt': strToU8('1234567890'),
    });
    const reader = bufferReader(archive);

    expect(() =>
      inspectZipStream(reader, {
        maxEntries: 1,
        maxEntryUncompressedBytes: 1024,
        maxTotalUncompressedBytes: 1024,
      }),
    ).toThrow('The EPUB archive contains too many entries.');

    expect(() =>
      inspectZipStream(reader, {
        maxEntries: 10,
        maxEntryUncompressedBytes: 1024,
        maxTotalUncompressedBytes: 15,
      }),
    ).toThrow('The EPUB archive expands beyond the size limit.');
  });
});

describe('selective EPUB inspection', () => {
  it('inspectReaderBookAssets and inspectReaderBookEntries produce identical metadata and cover', async () => {
    const coverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const files: Record<string, Uint8Array> = {
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="OEBPS/content.opf" /></rootfiles></container>',
      ),
      'OEBPS/content.opf': strToU8(`
        <package xmlns:dc="http://purl.org/dc/elements/1.1/">
          <metadata>
            <dc:title>测试轻小说</dc:title>
            <dc:creator>作者甲</dc:creator>
            <dc:language>zh-CN</dc:language>
            <dc:identifier>urn:test:1</dc:identifier>
          </metadata>
          <manifest>
            <item id="cover" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image" />
            <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml" />
          </manifest>
          <spine><itemref idref="ch1" /></spine>
        </package>
      `),
      'OEBPS/images/cover.jpg': coverBytes,
      'OEBPS/text/ch1.xhtml': strToU8('<html><body>Hello</body></html>'),
    };
    const archive = zipSync(files, { level: 0 });
    const arrayBuffer = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength);

    const fromArchive = inspectReaderBookAssets(arrayBuffer);
    const readPaths: string[] = [];
    const fromEntries = await inspectReaderBookEntries(async (path) => {
      readPaths.push(path);
      return files[path];
    });

    expect(fromEntries).toEqual(fromArchive);
    expect(fromEntries.metadata).toMatchObject({
      title: '测试轻小说',
      creator: '作者甲',
      language: 'zh-CN',
      identifier: 'urn:test:1',
    });
    expect(fromEntries.cover?.bytes).toEqual(coverBytes);
    // Only metadata XML and cover image were read — never the chapter body.
    expect(readPaths).toEqual(['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/images/cover.jpg']);
  });
});

describe('chunked FileHandle writes', () => {
  it('writes via FileHandle.writeBytes in <= 512 KiB chunks without calling File.write and releases the handle', async () => {
    const payload = Uint8Array.from({ length: 1_200_000 }, (_, index) => (index * 7) & 0xff);
    const writtenChunks: Uint8Array[] = [];
    const close = vi.fn();
    const release = vi.fn();
    const fileWrite = vi.fn();
    const create = vi.fn();
    const open = vi.fn(() => ({
      writeBytes(chunk: Uint8Array) {
        writtenChunks.push(chunk.slice());
      },
      close,
      release,
    }));
    const mockFile = { create, open, write: fileWrite } as unknown as Parameters<typeof writeFileBytes>[0];

    writeFileBytes(mockFile, payload);

    expect(fileWrite).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({ intermediates: true, overwrite: true });
    expect(open).toHaveBeenCalledWith('wt');
    expect(writtenChunks.length).toBe(3);
    expect(writtenChunks.every((chunk) => chunk.byteLength <= 512 * 1024)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);

    const combined = new Uint8Array(writtenChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of writtenChunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    expect(Buffer.compare(combined, payload)).toBe(0);

    writtenChunks.length = 0;
    await writeFileBytesAsync(mockFile, payload);
    expect(fileWrite).not.toHaveBeenCalled();
    expect(writtenChunks.length).toBe(3);
    expect(close).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
  });
});
