import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { writeEpub } from '../../src/features/plugins/services/plugin-epub-writer';

const defaults = { language: 'zh-CN', identifier: 'urn:lunar:test', now: () => new Date('2026-11-16T08:00:00.123Z') };
const png = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mediaType: 'image/png' as const };

describe('EPUB writer', () => {
  it('packages chapters, a cover and shared images as an EPUB 3 archive', () => {
    const archive = writeEpub(
      {
        title: 'Book <1>',
        author: 'Author & Co',
        source: 'https://example.com/book/1',
        identifier: 'urn:example:1',
        subjects: ['Fantasy'],
        cover: png,
        chapters: [
          {
            title: 'One',
            blocks: [
              { type: 'heading', text: 'Part' },
              { type: 'paragraph', text: 'Text with "quotes"\u0001' },
              { type: 'image', image: png, alt: 'Cover again' },
            ],
          },
          { title: 'Two', blocks: [{ type: 'paragraph', text: 'More' }] },
        ],
      },
      defaults,
    );
    const files = unzipSync(archive);
    expect(Object.keys(files)[0]).toBe('mimetype');
    expect(strFromU8(files.mimetype!)).toBe('application/epub+zip');

    const opf = strFromU8(files['OEBPS/content.opf']!);
    expect(opf).toContain('<dc:identifier id="bookId">urn:example:1</dc:identifier>');
    expect(opf).toContain('<dc:title>Book &lt;1&gt;</dc:title>');
    expect(opf).toContain('<dc:creator>Author &amp; Co</dc:creator>');
    expect(opf).toContain('<dc:language>zh-CN</dc:language>');
    expect(opf).toContain('<dc:subject>Fantasy</dc:subject>');
    expect(opf).toContain('<meta property="dcterms:modified">2026-11-16T08:00:00Z</meta>');
    // The cover and the chapter image are the same object, so the archive holds it once.
    expect(opf).toContain('<item id="image-1" href="images/image-1.png" media-type="image/png" properties="cover-image" />');
    expect(opf).not.toContain('image-2');
    expect(opf.match(/<itemref /g)).toHaveLength(2);

    const chapter = strFromU8(files['OEBPS/text/chapter-1.xhtml']!);
    expect(chapter).toContain('<h2>Part</h2>');
    expect(chapter).toContain('<p>Text with &quot;quotes&quot;</p>');
    expect(chapter).toContain('<img src="../images/image-1.png" alt="Cover again" />');
    expect(strFromU8(files['OEBPS/nav.xhtml']!)).toContain('<a href="text/chapter-2.xhtml">Two</a>');
    expect(strFromU8(files['OEBPS/toc.ncx']!)).toContain('<meta name="dtb:uid" content="urn:example:1" />');
    expect(files['OEBPS/images/image-1.png']).toEqual(png.bytes);
  });

  it('fills in the language and identifier and leaves out empty metadata', () => {
    const opf = strFromU8(
      unzipSync(writeEpub({ title: 'Book', chapters: [{ title: 'One', blocks: [] }] }, defaults))['OEBPS/content.opf']!,
    );
    expect(opf).toContain('<dc:identifier id="bookId">urn:lunar:test</dc:identifier>');
    expect(opf).toContain('<dc:language>zh-CN</dc:language>');
    expect(opf).not.toContain('dc:creator');
  });

  it('refuses input it cannot package', () => {
    expect(() => writeEpub({ title: 'Book', chapters: [] }, defaults)).toThrow('at least one chapter');
    expect(() => writeEpub({ title: ' ', chapters: [{ title: 'One', blocks: [] }] }, defaults)).toThrow('title');
    expect(() =>
      writeEpub(
        {
          title: 'Book',
          chapters: [
            {
              title: 'One',
              blocks: [{ type: 'image', image: { bytes: new Uint8Array(1), mediaType: 'image/bmp' as 'image/png' } }],
            },
          ],
        },
        defaults,
      ),
    ).toThrow('media type');
    expect(() =>
      writeEpub(
        { title: 'Book', chapters: [{ title: 'One', blocks: [{ type: 'html', html: '<b/>' } as never] }] },
        defaults,
      ),
    ).toThrow('paragraphs, headings or images');
  });
});
