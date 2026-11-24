import {
  compareVersions,
  satisfiesVersionRange,
  SDK_VERSION,
  type MarketEntry,
  type PluginCatalogEntry,
} from '@umbrae-labs/lunar-plugin-sdk/manifest';
import type { InstalledPlugin } from '../domain/installed-plugin';
import type { TrustedSigningKey } from './plugin-installer';

export type CatalogFetch = (url: string, init?: RequestInit) => Promise<Response>;
export interface MarketListing {
  readonly entry: MarketEntry;
  readonly publisher: TrustedSigningKey;
}
export interface CatalogOffer extends MarketListing {
  readonly state: 'install' | 'update' | 'installed' | 'incompatible';
  readonly installedVersion?: string;
}

export function listCatalogOffers(
  listings: readonly MarketListing[],
  installed: readonly InstalledPlugin[],
): CatalogOffer[] {
  return listings.flatMap((listing) => {
    const current = installed.find((plugin) => plugin.id === listing.entry.id);
    if (current?.signerKeyId && current.signerKeyId !== listing.publisher.keyId) return [];
    const compatible = satisfiesVersionRange(SDK_VERSION, listing.entry.sdk);
    const state = !compatible
      ? 'incompatible'
      : !current
        ? 'install'
        : compareVersions(listing.entry.version, current.version) > 0
          ? 'update'
          : 'installed';
    return [{ ...listing, state, installedVersion: current?.version }];
  });
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
