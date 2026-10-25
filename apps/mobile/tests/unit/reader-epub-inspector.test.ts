import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { discoverReaderInitialSpineHref, inspectReaderBookAssets } from '../../src/reader/rito/epub-inspector';

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

const packageXml = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata>
    <dc:title>Example &amp; Book</dc:title><dc:language>en</dc:language><dc:identifier>example</dc:identifier>
    <meta content="jacket" name="cover" />
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
    <item id="other" href="other.png" media-type="image/png" />
    <item id="jacket" href="jacket.png" media-type="image/png" />
  </manifest>
  <spine><itemref idref="chapter" /></spine>
</package>`;

function xmlEpub(
  opf = packageXml,
  container = `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OPS/package.opf" /></rootfiles></container>`,
): ArrayBuffer {
  const bytes = zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(container),
    'OPS/package.opf': strToU8(opf),
    'OPS/chapter.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><body>Example</body></html>'),
    'OPS/other.png': new Uint8Array([1]),
    'OPS/jacket.png': new Uint8Array([2]),
  });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('EPUB XML serialization compatibility', () => {
  it('accepts whitespace around attribute assignments in the container and package', () => {
    const archive = xmlEpub(
      packageXml.replaceAll('=', ' = '),
      `<container><rootfiles>
      <rootfile full-path \n = 'OPS/package.opf' /></rootfiles></container>`,
    );
    expect(inspectReaderBookAssets(archive).metadata.title).toBe('Example & Book');
    expect(discoverReaderInitialSpineHref(archive)).toBe('OPS/chapter.xhtml');
  });

  it('matches OCF and OPF namespaces independently of their prefixes', () => {
    const prefixed = packageXml
      .replace('xmlns="http://www.idpf.org/2007/opf"', 'xmlns:book="http://www.idpf.org/2007/opf"')
      .replace(/<(\/?)(package|metadata|manifest|item|spine|itemref|meta)(?=[\s/>])/g, '<$1book:$2');
    const archive = xmlEpub(
      prefixed,
      `<c:container xmlns:c="urn:oasis:names:tc:opendocument:xmlns:container">
      <c:rootfiles><c:rootfile full-path="OPS/package.opf" /></c:rootfiles></c:container>`,
    );
    const result = inspectReaderBookAssets(archive);
    expect(result.metadata.title).toBe('Example & Book');
    expect(result.cover?.source).toBe('jacket.png');
    expect(discoverReaderInitialSpineHref(archive)).toBe('OPS/chapter.xhtml');
  });

  it('reads EPUB 2 cover metadata regardless of attribute order', () => {
    expect(inspectReaderBookAssets(xmlEpub()).cover?.bytes).toEqual(new Uint8Array([2]));
  });

  it('does not read commented-out manifest and spine markup', () => {
    const opf = packageXml
      .replace('<manifest>', '<!-- <item id="fake" /> -->\n<manifest>')
      .replace('<spine>', '<!-- <spine><itemref idref="fake" /></spine> -->\n<spine>');
    expect(discoverReaderInitialSpineHref(xmlEpub(opf))).toBe('OPS/chapter.xhtml');
  });

  it('preserves CDATA and decodes character references exactly once', () => {
    const opf = packageXml.replace('Example &amp; Book', '<![CDATA[<Book> & text]]> &#x1F319; &amp;lt;');
    expect(inspectReaderBookAssets(xmlEpub(opf)).metadata.title).toBe('<Book> & text 🌙 &lt;');
  });

  it('ignores similarly named elements outside the Dublin Core namespace or metadata section', () => {
    const opf = packageXml.replace(
      '<metadata>',
      '<title>Outside</title><metadata><x:title xmlns:x="urn:foreign">Wrong</x:title>',
    );
    expect(inspectReaderBookAssets(xmlEpub(opf)).metadata.title).toBe('Example & Book');
  });

  it('does not decode ampersand entities in resource paths twice', () => {
    const opf = packageXml.replace('chapter.xhtml', 'chapter&amp;lt;.xhtml');
    expect(discoverReaderInitialSpineHref(xmlEpub(opf))).toBe('OPS/chapter&lt;.xhtml');
  });

  it('rejects malformed XML instead of accepting a regex substring', () => {
    expect(() => inspectReaderBookAssets(xmlEpub(packageXml.replace('</manifest>', '</broken>')))).toThrow();
  });

  it('preserves package traversal rejection after XML entity decoding', () => {
    const archive = xmlEpub(
      packageXml,
      '<container><rootfiles><rootfile full-path="&#46;&#46;/package.opf" /></rootfiles></container>',
    );
    expect(() => inspectReaderBookAssets(archive)).toThrow('The EPUB package path is unsafe.');
  });
});
