import { strFromU8 } from 'fflate';
import {
  compareVersions,
  parsePluginCatalog,
  satisfiesVersionRange,
  SDK_VERSION,
  type PluginCatalog,
  type PluginCatalogEntry,
} from '@umbrae-labs/lunar-plugin-sdk/manifest';
import { jwkThumbprint, PACKAGE_LIMITS, type Sha256 } from '@umbrae-labs/lunar-plugin-sdk/package-format';

import { LunarPluginError } from '../domain/plugin-error';
import type { InstalledPlugin } from '../domain/installed-plugin';

export type CatalogFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A catalog index as fetched, with the thumbprint of its signing key. */
export interface FetchedCatalog {
  readonly url: string;
  readonly catalog: PluginCatalog;
  readonly keyId: string;
}

const CATALOG_INDEX_BYTES = 1024 * 1024;
const HTTPS_URL = /^https:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/i;

/** Trims the URL and returns it when it is an HTTPS URL; catalogs are never fetched over plain HTTP. */
export function normalizeCatalogUrl(url: string): string | undefined {
  const trimmed = url.trim();
  return HTTPS_URL.test(trimmed) ? trimmed : undefined;
}

/** Resolves a package or icon location in a catalog against the index URL. */
export function resolveCatalogUrl(indexUrl: string, reference: string): string {
  if (HTTPS_URL.test(reference)) return reference;
  if (/^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith('//')) {
    throw new LunarPluginError('INVALID_ARGUMENT', `Catalog entries must use HTTPS: ${reference}`);
  }
  const base = indexUrl.replace(/[?#].*$/, '');
  if (reference.startsWith('/')) return `${/^https:\/\/[^/]+/i.exec(base)![0]}${reference}`;
  return `${base.slice(0, base.lastIndexOf('/') + 1)}${reference}`;
}

export async function fetchPluginCatalog(url: string, fetch: CatalogFetch, sha256: Sha256): Promise<FetchedCatalog> {
  const target = normalizeCatalogUrl(url);
  if (!target) throw new LunarPluginError('INVALID_ARGUMENT', 'A catalog address must start with https://');
  const response = await fetch(target, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new LunarPluginError('NETWORK_DENIED', `The catalog returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > CATALOG_INDEX_BYTES) {
    throw new LunarPluginError('INTEGRITY_FAILED', 'The catalog index is too large');
  }
  let value: unknown;
  try {
    value = JSON.parse(strFromU8(bytes));
  } catch {
    throw new LunarPluginError('INTEGRITY_FAILED', 'The address does not point to a plugin catalog');
  }
  const parsed = parsePluginCatalog(value);
  if (!parsed.ok) {
    throw new LunarPluginError('INTEGRITY_FAILED', `The catalog is invalid: ${parsed.issues.slice(0, 3).join('; ')}`);
  }
  return { url: target, catalog: parsed.catalog, keyId: await jwkThumbprint(parsed.catalog.signingKey, sha256) };
}

/** Downloads a package and checks it against the size and digest the catalog lists. */
export async function downloadCatalogPackage(
  catalogUrl: string,
  entry: PluginCatalogEntry,
  fetch: CatalogFetch,
  sha256: Sha256,
): Promise<Uint8Array> {
  if (entry.size > PACKAGE_LIMITS.archiveBytes) {
    throw new LunarPluginError('INTEGRITY_FAILED', `The package exceeds ${PACKAGE_LIMITS.archiveBytes} bytes`);
  }
  const response = await fetch(resolveCatalogUrl(catalogUrl, entry.package));
  if (!response.ok) throw new LunarPluginError('NETWORK_DENIED', `The download returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== entry.size || (await sha256(bytes)).toLowerCase() !== entry.sha256) {
    throw new LunarPluginError('INTEGRITY_FAILED', 'The downloaded package does not match the catalog');
  }
  return bytes;
}

export type CatalogOfferState = 'install' | 'update' | 'installed' | 'incompatible';

/** One catalog entry as it relates to what is installed. */
export interface CatalogOffer {
  readonly catalogUrl: string;
  readonly catalogName: string;
  readonly badge?: string;
  readonly entry: PluginCatalogEntry;
  readonly state: CatalogOfferState;
  readonly installedVersion?: string;
}

/**
 * Lists every entry of the given catalogs. Entries of an installed plugin only count from catalogs
 * signed with the key the plugin was installed with, since other publishers cannot update it.
 */
export function listCatalogOffers(
  catalogs: readonly (FetchedCatalog & { readonly name: string; readonly badge?: string })[],
  installed: readonly InstalledPlugin[],
): readonly CatalogOffer[] {
  return catalogs.flatMap((catalog) =>
    catalog.catalog.plugins.flatMap((entry): CatalogOffer[] => {
      const current = installed.find((plugin) => plugin.id === entry.id);
      if (current?.signerKeyId && current.signerKeyId !== catalog.keyId) return [];
      const compatible = satisfiesVersionRange(SDK_VERSION, entry.sdk);
      const order = current ? compareVersions(entry.version, current.version) : 1;
      return [
        {
          catalogUrl: catalog.url,
          catalogName: catalog.name,
          badge: catalog.badge,
          entry,
          installedVersion: current?.version,
          state: !compatible ? 'incompatible' : !current ? 'install' : order > 0 ? 'update' : 'installed',
        },
      ];
    }),
  );
}

/** Name and description in the closest of the catalog's locales. */
export function localizeCatalogEntry(
  entry: PluginCatalogEntry,
  language: string,
): { readonly name: string; readonly description?: string } {
  const locales = entry.locales ?? {};
  const base = language.split('-')[0];
  const match = locales[language] ?? Object.entries(locales).find(([locale]) => locale.split('-')[0] === base)?.[1];
  return { name: match?.name ?? entry.name, description: match?.description ?? entry.description };
}
