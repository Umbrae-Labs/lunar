import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  discoverReaderInitialSpineHref,
  inspectReaderBookAssets,
  inspectReaderBookAssetsAsync,
} from '../../src/reader/rito/epub-inspector';

function epub(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`
      <container>
        <rootfiles>
          <rootfile full-path="OPS/package.opf" />
        </rootfiles>
      </container>
    `),
    'OPS/package.opf': strToU8(`
      <package>
        <manifest>
          <item id="cover" href="Text/cover.xhtml" media-type="application/xhtml+xml" />
          <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml" />
        </manifest>
        <spine>
          <itemref idref="cover" linear="no" />
          <itemref idref="chapter" />
        </spine>
      </package>
    `),
    ...entries,
  });
}

describe('reader EPUB initial spine discovery', () => {
  it('returns the first linear HTML spine entry', () => {
    const archive = epub({
      'OPS/Text/cover.xhtml': strToU8('<html><body>Cover</body></html>'),
      'OPS/Text/chapter.xhtml': strToU8('<html><body>Chapter</body></html>'),
      'OPS/Images/large.bin': new Uint8Array(4 * 1024 * 1024),
    });

    expect(discoverReaderInitialSpineHref(archive)).toBe('OPS/Text/chapter.xhtml');
  });

  it('reports a missing package entry', () => {
    const archive = zipSync({
      'META-INF/container.xml': strToU8(
        '<container><rootfiles><rootfile full-path="OPS/missing.opf" /></rootfiles></container>',
      ),
    });

    expect(() => discoverReaderInitialSpineHref(archive)).toThrow('The EPUB archive is missing OPS/missing.opf.');
  });
});

describe('selected EPUB metadata and cover reads', () => {
  function metadataEpub(manifest: string, resources: Record<string, Uint8Array> = {}) {
    return epub({
      'OPS/package.opf': strToU8(`<package xmlns:dc="http://purl.org/dc/elements/1.1/">
        <metadata><dc:title>测试书</dc:title><dc:language>zh</dc:language>
        <dc:identifier>urn:uuid:test</dc:identifier><dc:creator>作者</dc:creator></metadata>
        <manifest>${manifest}</manifest></package>`),
      ...resources,
    });
  }

  it('keeps synchronous and asynchronous metadata/cover results equivalent', async () => {
    const image = new Uint8Array([137, 80, 78, 71, 255]);
    const archive = metadataEpub(
      '<item id="image" href="Images/封面.png" media-type="image/png" properties="cover-image" />',
      { 'OPS/Images/封面.png': image },
    );
    const result = await inspectReaderBookAssetsAsync(archive.buffer);
    expect(result).toEqual(inspectReaderBookAssets(archive.buffer));
    expect(result.metadata).toEqual({ title: '测试书', language: 'zh', identifier: 'urn:uuid:test', creator: '作者' });
    expect(result.cover).toMatchObject({ source: 'Images/封面.png', mediaType: 'image/png', bytes: image });
  });

  it('follows a cover XHTML image reference instead of choosing the first manifest image', async () => {
    const selected = new Uint8Array([1, 2, 3]);
    const archive = metadataEpub(
      `<item id="logo" href="Images/logo.png" media-type="image/png" />
       <item id="cover" href="Text/cover.xhtml" media-type="application/xhtml+xml" />
       <item id="picture" href="Images/picture.png" media-type="image/png" />`,
      {
        'OPS/Images/logo.png': new Uint8Array([9]),
        'OPS/Images/picture.png': selected,
        'OPS/Text/cover.xhtml': strToU8('<html><body><img src="../Images/picture.png" /></body></html>'),
      },
    );
    const result = await inspectReaderBookAssetsAsync(archive.buffer);
    expect(result).toEqual(inspectReaderBookAssets(archive.buffer));
    expect(result.cover?.bytes).toEqual(selected);
    expect(result.cover?.source).toBe('Images/picture.png');
  });

  it('does not inflate a damaged body/font when only metadata is requested', async () => {
    const archive = metadataEpub('<item id="font" href="font.otf" media-type="font/otf" />', {
      'OPS/font.otf': new Uint8Array(1024 * 1024),
    });
    const view = new DataView(archive.buffer);
    let offset = view.getUint32(archive.length - 6, true);
    while (view.getUint32(offset, true) === 0x02014b50) {
      const nameLength = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(archive.subarray(offset + 46, offset + 46 + nameLength));
      if (name === 'OPS/font.otf') {
        const local = view.getUint32(offset + 42, true);
        const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        archive[data] = 0x07;
        break;
      }
      offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
    const result = await inspectReaderBookAssetsAsync(archive.buffer);
    expect(result).toEqual(inspectReaderBookAssets(archive.buffer));
    expect(result.metadata.title).toBe('测试书');
    expect(result.cover).toBeUndefined();
  });

  it('preserves the missing package error in the asynchronous import path', async () => {
    const archive = zipSync({
      'META-INF/container.xml': strToU8('<container><rootfile full-path="OPS/missing.opf" /></container>'),
    });
    await expect(inspectReaderBookAssetsAsync(archive.buffer)).rejects.toThrow(
      'The EPUB archive is missing OPS/missing.opf.',
    );
  });
});
