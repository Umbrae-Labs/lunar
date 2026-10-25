import { strFromU8, unzipSync } from 'fflate';
import { DOMParser, type Document, type Element } from '@xmldom/xmldom';

import type { ReaderBookInspection, ReaderBookMetadata } from '../contracts';

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 5_000;
const OCF_NAMESPACE = 'urn:oasis:names:tc:opendocument:xmlns:container';
const OPF_NAMESPACE = 'http://www.idpf.org/2007/opf';
const DC_NAMESPACE = 'http://purl.org/dc/elements/1.1/';

/** Reads book metadata and a cover without depending on the former Rito JS core. */
export function inspectReaderBook(data: ArrayBuffer): ReaderBookMetadata {
  return inspectReaderBookAssets(data).metadata;
}

export function inspectReaderBookAssets(data: ArrayBuffer): ReaderBookInspection {
  const bytes = new Uint8Array(data);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('The EPUB archive size is outside the supported range.');
  }
  const entries = unzipSync(bytes);
  const names = Object.keys(entries);
  if (names.length > MAX_ENTRIES) throw new Error('The EPUB archive contains too many entries.');
  let totalBytes = 0;
  for (const name of names) {
    const size = entries[name]?.byteLength ?? 0;
    if (size > MAX_ENTRY_UNCOMPRESSED_BYTES) throw new Error(`The EPUB entry ${name} exceeds the size limit.`);
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error('The EPUB archive expands beyond the size limit.');
  }
  const container = readText(entries, 'META-INF/container.xml');
  const packagePath = readPackagePath(container);
  const packageXml = parseXml(readText(entries, packagePath));
  const metadata = readMetadata(packageXml);
  const manifest = readManifest(packageXml, packagePath);
  return { metadata, cover: findCover(entries, manifest, packageXml, packagePath) };
}

/** Returns the first linear spine document in the EPUB archive. */
export function discoverReaderInitialSpineHref(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const container = readSelectedText(bytes, 'META-INF/container.xml');
  const packagePath = readPackagePath(container);
  const packageXml = parseXml(readSelectedText(bytes, packagePath));
  const manifest = new Map(readManifest(packageXml, packagePath).map((item) => [item.id, item]));
  const spine = children(packageXml.documentElement, 'spine', OPF_NAMESPACE)[0];
  const itemrefs = children(spine, 'itemref', OPF_NAMESPACE).map((item) => ({
    idref: attribute(item.getAttribute('idref')),
    linear: item.getAttribute('linear')?.toLowerCase(),
  }));
  const firstLinear = itemrefs.find(
    (item) => item.linear !== 'no' && manifest.get(item.idref)?.mediaType.includes('html'),
  );
  const firstDocument = firstLinear ?? itemrefs.find((item) => manifest.get(item.idref)?.mediaType.includes('html'));
  const href = firstDocument ? manifest.get(firstDocument.idref)?.href : undefined;
  if (!href) throw new Error('The EPUB package has no HTML document in its spine.');
  return href;
}

/** Extracts one small metadata entry without inflating every EPUB resource. */
function readSelectedText(bytes: Uint8Array, path: string): string {
  const entries = unzipSync(bytes, {
    filter: (entry) => entry.name === path,
  });
  return readText(entries, path);
}

interface ManifestItem {
  readonly id: string;
  readonly href: string;
  readonly mediaType: string;
  readonly properties: string;
}

function readMetadata(xml: Document): ReaderBookMetadata {
  const section = children(xml.documentElement, 'metadata', OPF_NAMESPACE)[0];
  const metadata = (name: string) =>
    children(section, name, DC_NAMESPACE)[0]?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
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

function readManifest(xml: Document, packagePath: string): readonly ManifestItem[] {
  const base = packagePath.includes('/') ? packagePath.slice(0, packagePath.lastIndexOf('/') + 1) : '';
  const manifest = children(xml.documentElement, 'manifest', OPF_NAMESPACE)[0];
  return children(manifest, 'item', OPF_NAMESPACE).map((item) => ({
    id: attribute(item.getAttribute('id')),
    href: resolveRelative(base, attribute(item.getAttribute('href'))),
    mediaType: attribute(item.getAttribute('media-type')),
    properties: item.getAttribute('properties') ?? '',
  }));
}

function findCover(
  entries: Record<string, Uint8Array>,
  manifest: readonly ManifestItem[],
  packageXml: Document,
  packagePath: string,
): ReaderBookInspection['cover'] {
  const metadata = children(packageXml.documentElement, 'metadata', OPF_NAMESPACE)[0];
  const metaCover = children(metadata, 'meta', OPF_NAMESPACE)
    .find((item) => item.getAttribute('name') === 'cover')
    ?.getAttribute('content');
  const item = manifest.find(
    (candidate) =>
      candidate.properties.split(/\s+/).includes('cover-image') ||
      candidate.id === metaCover ||
      /(^|[\W_])cover([\W_]|$)/i.test(candidate.id) ||
      /(^|\/)cover[\W_]/i.test(candidate.href),
  );
  const imageItem = item?.mediaType.startsWith('image/') ? item : findCoverImageFromXhtml(entries, manifest);
  const selected = imageItem ?? manifest.find((candidate) => candidate.mediaType.startsWith('image/'));
  if (!selected) return undefined;
  const bytes = entries[selected.href];
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

function findCoverImageFromXhtml(
  entries: Record<string, Uint8Array>,
  manifest: readonly ManifestItem[],
): ManifestItem | undefined {
  const pages = manifest.filter((item) => /html/i.test(item.mediaType) && /cover/i.test(item.href));
  for (const page of pages) {
    const xml = entries[page.href] ? strFromU8(entries[page.href]!) : '';
    let source: string | null | undefined;
    try {
      const document = parseXml(xml);
      const image = Array.from(document.getElementsByTagName('*')).find(
        (element) => element.localName === 'img' || element.localName === 'image',
      );
      source =
        image?.getAttribute('src') ||
        image?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
        image?.getAttribute('href');
    } catch {
      // A malformed optional cover page must not prevent metadata import.
      continue;
    }
    if (!source) continue;
    const resolved = resolveRelative(
      page.href.includes('/') ? page.href.slice(0, page.href.lastIndexOf('/') + 1) : '',
      source,
    );
    const image = manifest.find(
      (item) =>
        item.mediaType.startsWith('image/') &&
        (item.href === resolved || item.href.endsWith(resolved) || resolved.endsWith(item.href)),
    );
    if (image) return image;
  }
  return undefined;
}

function readText(entries: Record<string, Uint8Array>, path: string): string {
  const bytes = entries[path];
  if (!bytes) throw new Error(`The EPUB archive is missing ${path}.`);
  return strFromU8(bytes);
}

function parseXml(xml: string): Document {
  return new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') throw new Error(`The EPUB XML is invalid: ${message}`);
    },
  }).parseFromString(xml, 'application/xml');
}

/** Match by namespace, never by a publisher's arbitrary prefix or XML serialization. */
function children(parent: Element | null | undefined, localName: string, namespace: string): Element[] {
  if (!parent) return [];
  return Array.from(parent.childNodes).filter(
    (node): node is Element =>
      node.nodeType === 1 &&
      (node as Element).localName === localName &&
      // Keep accepting older namespace-less books supported by the importer.
      (!(node as Element).namespaceURI || (node as Element).namespaceURI === namespace),
  );
}

function readPackagePath(containerXml: string): string {
  const container = parseXml(containerXml);
  const rootfiles = children(container.documentElement, 'rootfiles', OCF_NAMESPACE)[0];
  const rootfile = children(rootfiles, 'rootfile', OCF_NAMESPACE)[0];
  return normalizeArchivePath(attribute(rootfile?.getAttribute('full-path')));
}

function normalizeArchivePath(value: string | undefined): string {
  if (!value) throw new Error('The EPUB container has no package document.');
  const normalized = value.replaceAll('\\\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('/') || normalized.split('/').some((segment) => segment === '..'))
    throw new Error('The EPUB package path is unsafe.');
  return normalized;
}

function resolveRelative(base: string, href: string): string {
  const decoded = href.split(/[?#]/, 1)[0] ?? href;
  const parts = `${base}${decoded}`.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') normalized.pop();
    else normalized.push(part);
  }
  return normalized.join('/');
}

function attribute(value: string | null | undefined): string {
  if (!value) throw new Error('The EPUB XML contains a missing attribute.');
  return value;
}

function inferExtension(source: string, mediaType: string): string {
  const extension = source.split('.').at(-1)?.toLowerCase();
  if (extension && /^[a-z\d]{1,8}$/.test(extension)) return extension === 'jpeg' ? 'jpg' : extension;
  return mediaType.startsWith('image/') ? mediaType.slice(6).replace(/[^a-z\d]/gi, '') || 'img' : 'img';
}
