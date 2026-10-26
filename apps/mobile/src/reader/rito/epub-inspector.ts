import { strFromU8 } from 'fflate';

import type { ReaderBookInspection, ReaderBookMetadata } from '../contracts';
import { EpubArchive } from './epub-archive';

/** Reads book metadata and a cover without depending on the former Rito JS core. */
export function inspectReaderBook(data: ArrayBuffer): ReaderBookMetadata {
  return inspectReaderBookAssets(data).metadata;
}

export function inspectReaderBookAssets(data: ArrayBuffer): ReaderBookInspection {
  const entries = new EpubArchive(data);
  const container = readText(entries, 'META-INF/container.xml');
  const packagePath = readPackagePath(container);
  const packageXml = readText(entries, packagePath);
  const metadata = readMetadata(packageXml);
  const manifest = readManifest(packageXml, packagePath);
  return { metadata, cover: findCover(entries, manifest, packageXml, packagePath) };
}

/** Import can yield between compressed chunks without requiring Worker support. */
export async function inspectReaderBookAssetsAsync(data: ArrayBuffer): Promise<ReaderBookInspection> {
  const entries = new EpubArchive(data);
  const container = await readTextAsync(entries, 'META-INF/container.xml');
  const packagePath = readPackagePath(container);
  const packageXml = await readTextAsync(entries, packagePath);
  const metadata = readMetadata(packageXml);
  const manifest = readManifest(packageXml, packagePath);
  const item = findCoverManifestItem(manifest, packageXml);
  let imageItem = item?.mediaType.startsWith('image/') ? item : undefined;
  if (!imageItem) {
    for (const page of coverPages(manifest)) {
      const bytes = await entries.readAsync(page.href);
      imageItem = imageFromCoverPage(bytes ? strFromU8(bytes) : '', page, manifest);
      if (imageItem) break;
    }
  }
  const selected = imageItem ?? manifest.find((candidate) => candidate.mediaType.startsWith('image/'));
  const cover = selected ? makeCover(selected, await entries.readAsync(selected.href), packagePath) : undefined;
  return { metadata, cover };
}

/** Returns the first linear spine document in the EPUB archive. */
export function discoverReaderInitialSpineHref(data: ArrayBuffer | Uint8Array): string {
  const entries = new EpubArchive(data);
  const container = readText(entries, 'META-INF/container.xml');
  const packagePath = readPackagePath(container);
  const packageXml = readText(entries, packagePath);
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

function readPackagePath(container: string): string {
  return normalizeArchivePath(attribute(container.match(/<rootfile\b[^>]*full-path=["']([^"']+)["']/i)?.[1]));
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

function findCover(
  entries: EpubArchive,
  manifest: readonly ManifestItem[],
  packageXml: string,
  packagePath: string,
): ReaderBookInspection['cover'] {
  const item = findCoverManifestItem(manifest, packageXml);
  const imageItem = item?.mediaType.startsWith('image/') ? item : findCoverImageFromXhtml(entries, manifest);
  const selected = imageItem ?? manifest.find((candidate) => candidate.mediaType.startsWith('image/'));
  if (!selected) return undefined;
  return makeCover(selected, entries.read(selected.href), packagePath);
}

function findCoverManifestItem(manifest: readonly ManifestItem[], packageXml: string): ManifestItem | undefined {
  const metaCover = packageXml.match(/<meta\b[^>]*name=["']cover["'][^>]*content=["']([^"']+)["']/i)?.[1];
  return manifest.find(
    (candidate) =>
      candidate.properties.split(/\s+/).includes('cover-image') ||
      candidate.id === metaCover ||
      /(^|[\W_])cover([\W_]|$)/i.test(candidate.id) ||
      /(^|\/)cover[\W_]/i.test(candidate.href),
  );
}

function makeCover(
  selected: ManifestItem,
  bytes: Uint8Array | undefined,
  packagePath: string,
): ReaderBookInspection['cover'] {
  if (!bytes) return undefined;
  const packageBase = packagePath.includes('/') ? packagePath.slice(0, packagePath.lastIndexOf('/') + 1) : '';
  const source = selected.href.startsWith(packageBase) ? selected.href.slice(packageBase.length) : selected.href;
  return {
    source,
    mediaType: selected.mediaType,
    fileExtension: inferExtension(source, selected.mediaType),
    bytes: bytes.slice(),
  };
}

function findCoverImageFromXhtml(entries: EpubArchive, manifest: readonly ManifestItem[]): ManifestItem | undefined {
  for (const page of coverPages(manifest)) {
    const bytes = entries.read(page.href);
    const image = imageFromCoverPage(bytes ? strFromU8(bytes) : '', page, manifest);
    if (image) return image;
  }
  return undefined;
}

function coverPages(manifest: readonly ManifestItem[]): readonly ManifestItem[] {
  return manifest.filter((item) => /html/i.test(item.mediaType) && /cover/i.test(item.href));
}

function imageFromCoverPage(
  xml: string,
  page: ManifestItem,
  manifest: readonly ManifestItem[],
): ManifestItem | undefined {
  const source = xml.match(/<(?:img|image)\b[^>]*(?:src|xlink:href|href)=["']([^"']+)["']/i)?.[1];
  if (!source) return undefined;
  const resolved = resolveRelative(
    page.href.includes('/') ? page.href.slice(0, page.href.lastIndexOf('/') + 1) : '',
    source,
  );
  return manifest.find(
    (item) =>
      item.mediaType.startsWith('image/') &&
      (item.href === resolved || item.href.endsWith(resolved) || resolved.endsWith(item.href)),
  );
}

function readText(entries: EpubArchive, path: string): string {
  const bytes = entries.read(path);
  if (!bytes) throw new Error(`The EPUB archive is missing ${path}.`);
  return strFromU8(bytes);
}

async function readTextAsync(entries: EpubArchive, path: string): Promise<string> {
  const bytes = await entries.readAsync(path);
  if (!bytes) throw new Error(`The EPUB archive is missing ${path}.`);
  return strFromU8(bytes);
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
