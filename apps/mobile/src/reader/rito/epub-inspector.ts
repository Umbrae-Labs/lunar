import { strFromU8, unzipSync } from 'fflate';

import type { ReaderBookInspection, ReaderBookMetadata } from '../contracts';

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 5_000;

/** Reads book metadata and a cover without depending on the former Rito JS core. */
export function inspectReaderBook(data: ArrayBuffer): ReaderBookMetadata {
  return inspectReaderBookAssets(data).metadata;
}

export function inspectReaderBookAssets(data: ArrayBuffer): ReaderBookInspection {
  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('The EPUB archive size is outside the supported range.');
  }
  const containerBytes = validateArchiveAndReadEntry(bytes, 'META-INF/container.xml');
  if (!containerBytes) throw new Error('The EPUB archive is missing META-INF/container.xml.');
  const packagePath = parsePackagePath(strFromU8(containerBytes));
  const packageXml = readSelectedText(bytes, packagePath);
  const metadata = readMetadata(packageXml);
  const manifest = readManifest(packageXml, packagePath);
  return { metadata, cover: findCoverFromArchive(bytes, manifest, packageXml, packagePath) };
}

/**
 * Reads book metadata and cover directly from extracted EPUB entries so callers
 * do not have to read or re-inflate the entire archive into memory.
 */
export async function inspectReaderBookEntries(
  readEntry: (path: string) => Promise<Uint8Array | undefined>,
): Promise<ReaderBookInspection> {
  const containerBytes = await readEntry('META-INF/container.xml');
  if (!containerBytes) throw new Error('The EPUB archive is missing META-INF/container.xml.');
  const packagePath = parsePackagePath(strFromU8(containerBytes));
  const packageBytes = await readEntry(packagePath);
  if (!packageBytes) throw new Error(`The EPUB archive is missing ${packagePath}.`);
  const packageXml = strFromU8(packageBytes);
  const metadata = readMetadata(packageXml);
  const manifest = readManifest(packageXml, packagePath);
  const cover = await findCoverFromEntries(readEntry, manifest, packageXml, packagePath);
  return { metadata, cover };
}

/** Returns the first linear spine document in the EPUB archive. */
export function discoverReaderInitialSpineHref(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const container = readSelectedText(bytes, 'META-INF/container.xml');
  const packagePath = parsePackagePath(container);
  const packageXml = readSelectedText(bytes, packagePath);
  const packageBase = packagePath.includes('/') ? packagePath.slice(0, packagePath.lastIndexOf('/') + 1) : '';
  const manifest = new Map<string, { href: string; mediaType: string }>();
  for (const match of packageXml.matchAll(/<item\b([^>]+)>/gi)) {
    const attrs = match[1] ?? '';
    const id = attribute(attrs.match(/\bid=["']([^"']+)["']/i)?.[1]);
    const href = attribute(attrs.match(/\bhref=["']([^"']+)["']/i)?.[1]);
    const mediaType = attribute(attrs.match(/\bmedia-type=["']([^"']+)["']/i)?.[1]);
    manifest.set(id, { href: resolveRelative(packageBase, href), mediaType });
  }
  const spineBody = packageXml.match(/<spine\b[^>]*>([\s\S]*?)<\/spine\s*>/i)?.[1] ?? '';
  const itemrefs = [...spineBody.matchAll(/<itemref\b([^>]+)>/gi)].map((match) => {
    const attrs = match[1] ?? '';
    const idref = attribute(attrs.match(/\bidref=["']([^"']+)["']/i)?.[1]);
    const linear = attrs.match(/\blinear=["']([^"']+)["']/i)?.[1]?.toLowerCase();
    return { idref, linear };
  });
  const firstLinear = itemrefs.find(
    (item) => item.linear !== 'no' && manifest.get(item.idref)?.mediaType.includes('html'),
  );
  const firstDocument = firstLinear ?? itemrefs.find((item) => manifest.get(item.idref)?.mediaType.includes('html'));
  const href = firstDocument ? manifest.get(firstDocument.idref)?.href : undefined;
  if (!href) throw new Error('The EPUB package has no HTML document in its spine.');
  return href;
}

/**
 * Validates ZIP entry count and uncompressed size limits from the central
 * directory while extracting only a single requested entry.
 */
function validateArchiveAndReadEntry(bytes: Uint8Array, targetPath: string): Uint8Array | undefined {
  let entryCount = 0;
  let totalBytes = 0;
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      entryCount += 1;
      if (entryCount > MAX_ENTRIES) {
        throw new Error('The EPUB archive contains too many entries.');
      }
      const size = entry.originalSize;
      if (size > MAX_ENTRY_UNCOMPRESSED_BYTES) {
        throw new Error(`The EPUB entry ${entry.name} exceeds the size limit.`);
      }
      totalBytes += size;
      if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('The EPUB archive expands beyond the size limit.');
      }
      return entry.name === targetPath;
    },
  });
  return entries[targetPath];
}

/** Extracts one small metadata entry without inflating every EPUB resource. */
function readSelectedText(bytes: Uint8Array, path: string): string {
  const entry = readOptionalSelectedBytes(bytes, path);
  if (!entry) throw new Error(`The EPUB archive is missing ${path}.`);
  return strFromU8(entry);
}

function readOptionalSelectedBytes(bytes: Uint8Array, path: string): Uint8Array | undefined {
  const entries = unzipSync(bytes, {
    filter: (entry) => entry.name === path,
  });
  return entries[path];
}

function parsePackagePath(containerXml: string): string {
  return normalizeArchivePath(attribute(containerXml.match(/<rootfile\b[^>]*full-path=["']([^"']+)["']/i)?.[1]));
}

interface ManifestItem {
  readonly id: string;
  readonly href: string;
  readonly mediaType: string;
  readonly properties: string;
}

function readMetadata(xml: string): ReaderBookMetadata {
  const metadata = (name: string) => extractXmlText(xml, name);
  const title = metadata('title');
  const language = metadata('language');
  const identifier = metadata('identifier');
  if (!title || !language || !identifier) throw new Error('The EPUB package metadata is incomplete.');
  return {
    title,
    language,
    identifier,
    creator: metadata('creator'),
    publisher: metadata('publisher'),
    description: metadata('description'),
  };
}

function readManifest(xml: string, packagePath: string): readonly ManifestItem[] {
  const base = packagePath.includes('/') ? packagePath.slice(0, packagePath.lastIndexOf('/') + 1) : '';
  return [...xml.matchAll(/<item\b([^>]+)>/gi)]
    .map((match) => {
      const attrs = match[1] ?? '';
      const id = attribute(attrs.match(/\bid=["']([^"']+)["']/i)?.[1]);
      const href = attribute(attrs.match(/\bhref=["']([^"']+)["']/i)?.[1]);
      const mediaType = attribute(attrs.match(/\bmedia-type=["']([^"']+)["']/i)?.[1]);
      const properties = attrs.match(/\bproperties=["']([^"']+)["']/i)?.[1] ?? '';
      return { id, href: resolveRelative(base, href), mediaType, properties };
    })
    .filter((item) => item.id && item.href && item.mediaType) as ManifestItem[];
}

function findDeclaredCoverItem(manifest: readonly ManifestItem[], packageXml: string): ManifestItem | undefined {
  const metaCover = packageXml.match(/<meta\b[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i)?.[1];
  return manifest.find(
    (candidate) =>
      candidate.properties.split(/\s+/).includes('cover-image') ||
      candidate.id === metaCover ||
      /(^|[\W_])cover([\W_]|$)/i.test(candidate.id) ||
      /(^|\/)cover[\W_]/i.test(candidate.href),
  );
}

function findCoverFromArchive(
  archiveBytes: Uint8Array,
  manifest: readonly ManifestItem[],
  packageXml: string,
  packagePath: string,
): ReaderBookInspection['cover'] {
  const item = findDeclaredCoverItem(manifest, packageXml);
  let imageItem = item?.mediaType.startsWith('image/') ? item : undefined;
  if (!imageItem) {
    const pages = manifest.filter((candidate) => /html/i.test(candidate.mediaType) && /cover/i.test(candidate.href));
    for (const page of pages) {
      const pageBytes = readOptionalSelectedBytes(archiveBytes, page.href);
      if (!pageBytes) continue;
      const image = resolveCoverImageFromXhtmlText(strFromU8(pageBytes), page.href, manifest);
      if (image) {
        imageItem = image;
        break;
      }
    }
  }
  const selected = imageItem ?? manifest.find((candidate) => candidate.mediaType.startsWith('image/'));
  if (!selected) return undefined;
  const bytes = readOptionalSelectedBytes(archiveBytes, selected.href);
  if (!bytes) return undefined;
  return buildCoverAsset(selected, bytes, packagePath);
}

async function findCoverFromEntries(
  readEntry: (path: string) => Promise<Uint8Array | undefined>,
  manifest: readonly ManifestItem[],
  packageXml: string,
  packagePath: string,
): Promise<ReaderBookInspection['cover']> {
  const item = findDeclaredCoverItem(manifest, packageXml);
  let imageItem = item?.mediaType.startsWith('image/') ? item : undefined;
  if (!imageItem) {
    const pages = manifest.filter((candidate) => /html/i.test(candidate.mediaType) && /cover/i.test(candidate.href));
    for (const page of pages) {
      const pageBytes = await readEntry(page.href);
      if (!pageBytes) continue;
      const image = resolveCoverImageFromXhtmlText(strFromU8(pageBytes), page.href, manifest);
      if (image) {
        imageItem = image;
        break;
      }
    }
  }
  const selected = imageItem ?? manifest.find((candidate) => candidate.mediaType.startsWith('image/'));
  if (!selected) return undefined;
  const bytes = await readEntry(selected.href);
  if (!bytes) return undefined;
  return buildCoverAsset(selected, bytes, packagePath);
}

function buildCoverAsset(
  selected: ManifestItem,
  bytes: Uint8Array,
  packagePath: string,
): NonNullable<ReaderBookInspection['cover']> {
  const packageBase = packagePath.includes('/') ? packagePath.slice(0, packagePath.lastIndexOf('/') + 1) : '';
  const source = selected.href.startsWith(packageBase) ? selected.href.slice(packageBase.length) : selected.href;
  return {
    source,
    mediaType: selected.mediaType,
    fileExtension: inferExtension(source, selected.mediaType),
    bytes,
  };
}

function resolveCoverImageFromXhtmlText(
  xml: string,
  pageHref: string,
  manifest: readonly ManifestItem[],
): ManifestItem | undefined {
  const source = xml.match(/<(?:img|image)\b[^>]*(?:src|xlink:href|href)=["']([^"']+)["']/i)?.[1];
  if (!source) return undefined;
  const resolved = resolveRelative(
    pageHref.includes('/') ? pageHref.slice(0, pageHref.lastIndexOf('/') + 1) : '',
    source,
  );
  return manifest.find(
    (item) =>
      item.mediaType.startsWith('image/') &&
      (item.href === resolved || item.href.endsWith(resolved) || resolved.endsWith(item.href)),
  );
}

function extractXmlText(xml: string, localName: string): string | undefined {
  const name = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  const match = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}\\s*>`, 'i'));
  if (!match?.[1]) return undefined;
  const value = match[1]
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return decodeXml(value) || undefined;
}

function normalizeArchivePath(value: string | undefined): string {
  if (!value) throw new Error('The EPUB container has no package document.');
  const normalized = decodeXml(value).replaceAll('\\\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || normalized.split('/').some((segment) => segment === '..'))
    throw new Error('The EPUB package path is unsafe.');
  return normalized;
}

function resolveRelative(base: string, href: string): string {
  const decoded = decodeXml(href).split(/[?#]/, 1)[0] ?? href;
  const parts = `${base}${decoded}`.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') normalized.pop();
    else normalized.push(part);
  }
  return normalized.join('/');
}

function attribute(value: string | undefined): string {
  if (!value) throw new Error('The EPUB XML contains a missing attribute.');
  return decodeXml(value);
}

function decodeXml(value: string): string {
  return value
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function inferExtension(source: string, mediaType: string): string {
  const extension = source.split('.').at(-1)?.toLowerCase();
  if (extension && /^[a-z\d]{1,8}$/.test(extension)) return extension === 'jpeg' ? 'jpg' : extension;
  return mediaType.startsWith('image/') ? mediaType.slice(6).replace(/[^a-z\d]/gi, '') || 'img' : 'img';
}
