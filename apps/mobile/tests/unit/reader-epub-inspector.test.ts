import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { discoverReaderInitialSpineHref } from '../../src/reader/rito/epub-inspector';

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

    expect(() => discoverReaderInitialSpineHref(archive)).toThrow(
      'The EPUB archive is missing OPS/missing.opf.',
    );
  });
});
