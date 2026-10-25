import { DOMParser, type Element } from '@xmldom/xmldom';
import { strFromU8, unzipSync } from 'fflate';

import type { ReaderEpubLayout } from '../contracts';

const OCF = 'urn:oasis:names:tc:opendocument:xmlns:container';
const OPF = 'http://www.idpf.org/2007/opf';
const RENDITION = 'http://www.idpf.org/vocab/rendition/#';

/** Inspect effective spine layouts without inflating chapter, image or font data. */
export function inspectReaderBookLayout(data: ArrayBuffer | Uint8Array): ReaderEpubLayout {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const container = readXml(bytes, 'META-INF/container.xml');
  const rootfiles = children(container, 'rootfiles', OCF)[0];
  const path = children(rootfiles, 'rootfile', OCF)[0]?.getAttribute('full-path');
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    throw new Error('The EPUB container has no valid package path.');
  }
  const packageRoot = readXml(bytes, path);
  const prefixes = new Map([['rendition', RENDITION]]);
  // EPUB vocabulary prefixes are a whitespace-separated prefix/IRI list;
  // this is an attribute value, never XML structure matching.
  const declarations = packageRoot.getAttribute('prefix')?.trim().split(/\s+/) ?? [];
  for (let index = 0; index + 1 < declarations.length; index += 2) {
    const prefix = declarations[index];
    if (prefix?.endsWith(':')) prefixes.set(prefix.slice(0, -1), declarations[index + 1]!);
  }
  const expand = (term: string) => {
    const colon = term.indexOf(':');
    const namespace = prefixes.get(term.slice(0, colon));
    return colon > 0 && namespace ? namespace + term.slice(colon + 1) : term;
  };
  const metadata = children(packageRoot, 'metadata', OPF)[0];
  const defaultLayout = children(metadata, 'meta', OPF)
    .find(
      (node) =>
        !node.hasAttribute('refines') && expand(node.getAttribute('property')?.trim() ?? '') === `${RENDITION}layout`,
    )
    ?.textContent?.trim();
  const defaultFixed = defaultLayout === 'pre-paginated';
  const spine = children(packageRoot, 'spine', OPF)[0];
  let fixedLayoutSpineItems = 0;
  let reflowableSpineItems = 0;
  for (const item of children(spine, 'itemref', OPF)) {
    const properties = new Set((item.getAttribute('properties') ?? '').trim().split(/\s+/).map(expand));
    const fixed = properties.has(`${RENDITION}layout-pre-paginated`)
      ? true
      : properties.has(`${RENDITION}layout-reflowable`)
        ? false
        : defaultFixed;
    if (fixed) fixedLayoutSpineItems += 1;
    else reflowableSpineItems += 1;
  }
  return {
    kind: fixedLayoutSpineItems === 0 ? 'reflowable' : reflowableSpineItems === 0 ? 'fixed' : 'mixed',
    fixedLayoutSpineItems,
    reflowableSpineItems,
  };
}

function readXml(bytes: Uint8Array, path: string): Element {
  const entry = unzipSync(bytes, { filter: (item) => item.name === path })[path];
  if (!entry) throw new Error(`The EPUB is missing ${path}.`);
  const document = new DOMParser({
    onError: (level, message) => {
      if (level !== 'warning') throw new Error(`The EPUB XML is invalid: ${message}`);
    },
  }).parseFromString(strFromU8(entry), 'application/xml');
  if (!document.documentElement) throw new Error(`The EPUB XML in ${path} has no root element.`);
  return document.documentElement;
}

function children(parent: Element | undefined, name: string, namespace: string): Element[] {
  return Array.from(parent?.childNodes ?? []).filter(
    (node): node is Element =>
      node.nodeType === 1 &&
      (node as Element).localName === name &&
      (!(node as Element).namespaceURI || (node as Element).namespaceURI === namespace),
  );
}
