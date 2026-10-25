import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { inspectReaderBookLayout, DEFAULT_READER_TYPOGRAPHY, READER_ERROR_CODES, type ReaderOpenRequest } from '../../src/reader';
import { loadReaderBook } from '../../src/features/reader/services/reader-book-loader';

const { readBook } = vi.hoisted(() => ({ readBook: vi.fn() }));
vi.mock('../../src/features/reader/infrastructure/expo-reader-book-loader', () => ({ readReaderBook: readBook }));
vi.mock('../../src/i18n', () => ({ i18n: { t: (key: string) => key } }));

function book(metadata = '', spine = '<o:itemref idref="a"/>', prefix = ''): ArrayBuffer {
  return zipSync({
    'META-INF/container.xml': strToU8(
      '<c:container xmlns:c="urn:oasis:names:tc:opendocument:xmlns:container"><c:rootfiles><c:rootfile full-path = "EPUB/book.opf"/></c:rootfiles></c:container>',
    ),
    'EPUB/book.opf': strToU8(
      `<o:package xmlns:o="http://www.idpf.org/2007/opf" ${prefix}><o:metadata>${metadata}</o:metadata><o:spine>${spine}</o:spine></o:package>`,
    ),
  }).buffer as ArrayBuffer;
}

describe('effective EPUB spine layout', () => {
  it('defaults EPUB 2 and undeclared EPUB 3 layouts to reflowable', () => {
    expect(inspectReaderBookLayout(book())).toEqual({
      kind: 'reflowable',
      fixedLayoutSpineItems: 0,
      reflowableSpineItems: 1,
    });
  });

  it('recognizes a global fixed layout through XML namespace prefixes and attribute whitespace', () => {
    const metadata = '<o:meta property = "rendition:layout"> pre-paginated </o:meta>';
    expect(inspectReaderBookLayout(book(metadata))).toEqual({
      kind: 'fixed',
      fixedLayoutSpineItems: 1,
      reflowableSpineItems: 0,
    });
  });

  it('detects fixed pages within a globally reflowable book', () => {
    const spine =
      '<o:itemref idref="a"/><o:itemref idref="b" properties="rendition:spread-none rendition:layout-pre-paginated"/>';
    expect(inspectReaderBookLayout(book('', spine))).toEqual({
      kind: 'mixed',
      fixedLayoutSpineItems: 1,
      reflowableSpineItems: 1,
    });
  });

  it('honors reflowable overrides in fixed books, including a complete override', () => {
    const metadata = '<o:meta property="rendition:layout">pre-paginated</o:meta>';
    const flow = '<o:itemref idref="about" properties="rendition:layout-reflowable"/>';
    expect(inspectReaderBookLayout(book(metadata, flow)).kind).toBe('reflowable');
    expect(inspectReaderBookLayout(book(metadata, flow + '<o:itemref idref="page"/>')).kind).toBe('mixed');
  });

  it('resolves declared EPUB vocabulary aliases for metadata and spine overrides', () => {
    const prefix = 'prefix="other: https://example.org/vocab/ r: http://www.idpf.org/vocab/rendition/#"';
    expect(
      inspectReaderBookLayout(
        book('<o:meta property="r:layout">pre-paginated</o:meta>', '<o:itemref idref="a"/>', prefix),
      ).kind,
    ).toBe('fixed');
    expect(
      inspectReaderBookLayout(book('', '<o:itemref idref="a" properties="r:layout-pre-paginated"/>', prefix)).kind,
    ).toBe('fixed');
  });

  it('ignores comments, foreign-namespace metadata and invalid refined global declarations', () => {
    const metadata =
      '<!-- <o:meta property="rendition:layout">pre-paginated</o:meta> --><x:meta xmlns:x="urn:foreign" property="rendition:layout">pre-paginated</x:meta><o:meta refines="#a" property="rendition:layout">pre-paginated</o:meta>';
    expect(inspectReaderBookLayout(book(metadata)).kind).toBe('reflowable');
  });

  it('does not silently accept malformed package XML', () => {
    expect(() => inspectReaderBookLayout(book('<o:meta>'))).toThrow(/XML is invalid/);
  });
});

describe('fixed-layout gate before native pagination', () => {
  const request: ReaderOpenRequest = {
    bookId: 'fixed',
    fileUri: 'book.epub',
    viewport: { width: 400, height: 800, pixelRatio: 1 },
    typography: DEFAULT_READER_TYPOGRAPHY,
    theme: 'light',
  };

  it('withholds fixed-layout bytes until the reader explicitly opts in', async () => {
    const data = book('<o:meta property="rendition:layout">pre-paginated</o:meta>');
    readBook.mockResolvedValue(data);
    await expect(loadReaderBook(request)).rejects.toMatchObject({
      code: READER_ERROR_CODES.unsupportedFixedLayout,
      details: { layout: { kind: 'fixed' } },
    });
    await expect(loadReaderBook({ ...request, allowUnsupportedFixedLayout: true })).resolves.toBe(data);
    await expect(loadReaderBook(request)).rejects.toMatchObject({ code: READER_ERROR_CODES.unsupportedFixedLayout });
  });

  it('also gates mixed books but leaves reflowable books unchanged', async () => {
    readBook.mockResolvedValue(
      book('', '<o:itemref idref="a"/><o:itemref idref="b" properties="rendition:layout-pre-paginated"/>'),
    );
    await expect(loadReaderBook(request)).rejects.toMatchObject({ details: { layout: { kind: 'mixed' } } });
    const data = book();
    readBook.mockResolvedValue(data);
    await expect(loadReaderBook(request)).resolves.toBe(data);
  });
});
