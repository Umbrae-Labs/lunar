import { strToU8, zipSync } from 'fflate';
import type { EpubBlock, EpubBuildInput, EpubImage, EpubImageType } from '@umbrae-labs/lunar-plugin-sdk';

import { LunarPluginError } from '../domain/plugin-error';

export const EPUB_WRITER_LIMITS = {
  chapters: 5_000,
  blocksPerChapter: 20_000,
  textCharacters: 32 * 1024 * 1024,
  images: 2_000,
  bytes: 100 * 1024 * 1024,
} as const;

const ImageExtensions: Readonly<Record<EpubImageType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

interface ImageAsset {
  readonly id: string;
  readonly path: string;
  readonly image: EpubImage;
  readonly cover: boolean;
}

interface ChapterDocument {
  readonly title: string;
  readonly fileName: string;
  readonly xhtml: string;
}

export interface EpubWriterDefaults {
  readonly language: string;
  /** Used when the input names no identifier. */
  readonly identifier: string;
  readonly now?: () => Date;
}

/**
 * Packages plain text and images as an EPUB 3 archive with a navigation document, the legacy NCX
 * and a `cover-image` item. Entries are stored uncompressed with `mimetype` first.
 */
export function writeEpub(input: EpubBuildInput, defaults: EpubWriterDefaults): Uint8Array {
  validate(input);
  const language = input.language?.trim() || defaults.language;
  const identifier = input.identifier?.trim() || defaults.identifier;
  const images = new Map<EpubImage, ImageAsset>();
  let imageBytes = 0;
  const addImage = (image: EpubImage, cover = false): ImageAsset => {
    const existing = images.get(image);
    if (existing) return existing;
    if (images.size >= EPUB_WRITER_LIMITS.images) {
      throw new LunarPluginError('QUOTA_EXCEEDED', `An EPUB holds up to ${EPUB_WRITER_LIMITS.images} images`);
    }
    imageBytes += image.bytes.byteLength;
    const index = images.size + 1;
    const asset = {
      id: `image-${index}`,
      path: `images/image-${index}.${ImageExtensions[image.mediaType]}`,
      image,
      cover,
    };
    images.set(image, asset);
    return asset;
  };
  // The cover is the first image, so readers that only look at the first entry still find it.
  if (input.cover) addImage(input.cover, true);

  const documents: ChapterDocument[] = input.chapters.map((chapter, index) => {
    const fileName = `chapter-${index + 1}.xhtml`;
    const body = chapter.blocks.map((block) => renderBlock(block, addImage)).join('\n');
    return {
      title: chapter.title,
      fileName,
      xhtml: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="../style.css" />
</head>
<body>
  <section epub:type="chapter" class="chapter">
    <h1>${escapeXml(chapter.title)}</h1>
${body}
  </section>
</body>
</html>
`,
    };
  });
  if (imageBytes > EPUB_WRITER_LIMITS.bytes) {
    throw new LunarPluginError('QUOTA_EXCEEDED', 'The EPUB exceeds the 100 MiB import limit');
  }

  const manifest = [
    '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />',
    '    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />',
    '    <item id="css" href="style.css" media-type="text/css" />',
    ...documents.map(
      ({ fileName }, index) =>
        `    <item id="chapter-${index + 1}" href="text/${fileName}" media-type="application/xhtml+xml" />`,
    ),
    ...[...images.values()].map(
      ({ id, path, image, cover }) =>
        `    <item id="${id}" href="${path}" media-type="${image.mediaType}"${cover ? ' properties="cover-image"' : ''} />`,
    ),
  ].join('\n');
  const spine = documents.map((_, index) => `    <itemref idref="chapter-${index + 1}" />`).join('\n');
  const optional = (tag: string, value: string | undefined) =>
    value?.trim() ? `\n    <dc:${tag}>${escapeXml(value.trim())}</dc:${tag}>` : '';
  const subjects = (input.subjects ?? [])
    .filter((subject) => subject.trim())
    .map((subject) => `\n    <dc:subject>${escapeXml(subject.trim())}</dc:subject>`)
    .join('');
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookId" xml:lang="${escapeXml(language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookId">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(input.title.trim())}</dc:title>${optional('creator', input.author)}
    <dc:language>${escapeXml(language)}</dc:language>${optional('publisher', input.publisher)}${optional(
      'description',
      input.description,
    )}${optional('source', input.source)}${subjects}
    <meta property="dcterms:modified">${modifiedTimestamp(defaults.now?.() ?? new Date())}</meta>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`;

  const entries: Record<string, Uint8Array> = {
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
</container>
`),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(navDocument(input.title.trim(), language, documents)),
    'OEBPS/toc.ncx': strToU8(ncxDocument(identifier, input.title.trim(), documents)),
    'OEBPS/style.css': strToU8(
      [
        'body { line-height: 1.7; margin: 5%; }',
        'h1 { font-size: 1.4em; margin-bottom: 1.5em; }',
        'h2 { font-size: 1.15em; margin: 1.2em 0 0.8em; }',
        'p { margin: 0.8em 0; text-indent: 2em; }',
        '.illustration { margin: 1em 0; text-align: center; }',
        '.illustration img { max-width: 100%; }',
        '',
      ].join('\n'),
    ),
  };
  for (const document of documents) entries[`OEBPS/text/${document.fileName}`] = strToU8(document.xhtml);
  for (const asset of images.values()) entries[`OEBPS/${asset.path}`] = asset.image.bytes;
  // Object insertion keeps mimetype first; level 0 stores every entry uncompressed.
  return zipSync(entries, { level: 0 });
}

function renderBlock(block: EpubBlock, addImage: (image: EpubImage) => ImageAsset): string {
  switch (block.type) {
    case 'paragraph':
      return `    <p>${escapeXml(block.text)}</p>`;
    case 'heading':
      return `    <h2>${escapeXml(block.text)}</h2>`;
    case 'image': {
      const asset = addImage(block.image);
      return `    <div class="illustration"><img src="../${asset.path}" alt="${escapeXml(block.alt ?? '')}" /></div>`;
    }
  }
}

function validate(input: EpubBuildInput): void {
  const invalid = (message: string) => new LunarPluginError('INVALID_ARGUMENT', message);
  if (typeof input !== 'object' || input === null) throw invalid('The EPUB input must be an object');
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500) {
    throw invalid('The EPUB needs a title of up to 500 characters');
  }
  for (const key of ['author', 'language', 'description', 'publisher', 'source', 'identifier'] as const) {
    const value = input[key];
    if (value !== undefined && (typeof value !== 'string' || value.length > 10_000)) {
      throw invalid(`${key} must be a string`);
    }
  }
  if (input.subjects !== undefined && (!Array.isArray(input.subjects) || input.subjects.length > 64)) {
    throw invalid('subjects must be up to 64 strings');
  }
  if (input.subjects?.some((subject) => typeof subject !== 'string')) throw invalid('subjects must be strings');
  if (input.cover !== undefined) validateImage(input.cover);
  if (!Array.isArray(input.chapters) || input.chapters.length === 0) {
    throw invalid('The EPUB needs at least one chapter');
  }
  if (input.chapters.length > EPUB_WRITER_LIMITS.chapters) {
    throw new LunarPluginError('QUOTA_EXCEEDED', `An EPUB holds up to ${EPUB_WRITER_LIMITS.chapters} chapters`);
  }
  let characters = 0;
  for (const chapter of input.chapters) {
    if (typeof chapter?.title !== 'string' || chapter.title.length > 500) {
      throw invalid('Every chapter needs a title of up to 500 characters');
    }
    if (!Array.isArray(chapter.blocks) || chapter.blocks.length > EPUB_WRITER_LIMITS.blocksPerChapter) {
      throw invalid(`A chapter holds up to ${EPUB_WRITER_LIMITS.blocksPerChapter} blocks`);
    }
    for (const block of chapter.blocks) {
      if (block?.type === 'paragraph' || block?.type === 'heading') {
        if (typeof block.text !== 'string') throw invalid('Text blocks need text');
        characters += block.text.length;
      } else if (block?.type === 'image') {
        validateImage(block.image);
        if (block.alt !== undefined && typeof block.alt !== 'string') throw invalid('alt must be a string');
      } else {
        throw invalid('Blocks are paragraphs, headings or images');
      }
    }
  }
  if (characters > EPUB_WRITER_LIMITS.textCharacters) {
    throw new LunarPluginError('QUOTA_EXCEEDED', 'The EPUB text is too long');
  }
}

function validateImage(image: EpubImage): void {
  if (
    typeof image !== 'object' ||
    image === null ||
    !(image.bytes instanceof Uint8Array) ||
    !(image.mediaType in ImageExtensions)
  ) {
    throw new LunarPluginError('INVALID_ARGUMENT', 'Images need bytes and a JPEG, PNG, GIF or WebP media type');
  }
}

function navDocument(title: string, language: string, documents: readonly ChapterDocument[]): string {
  const items = documents
    .map(({ title: chapter, fileName }) => `      <li><a href="text/${fileName}">${escapeXml(chapter)}</a></li>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(language)}" lang="${escapeXml(language)}">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(title)}</title>
</head>
<body>
  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1>${escapeXml(title)}</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>
`;
}

function ncxDocument(identifier: string, title: string, documents: readonly ChapterDocument[]): string {
  const navPoints = documents
    .map(
      ({ title: chapter, fileName }, index) => `    <navPoint id="nav-${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(chapter)}</text></navLabel>
      <content src="text/${fileName}" />
    </navPoint>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${escapeXml(identifier)}" /></head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`;
}

/** EPUB 3 requires a UTC `dcterms:modified` value without fractional seconds. */
function modifiedTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Escapes text for XML and drops characters XML 1.0 cannot hold. */
function escapeXml(value: string): string {
  return value
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
