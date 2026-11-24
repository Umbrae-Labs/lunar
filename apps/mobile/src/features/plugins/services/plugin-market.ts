import { readResponseBytes } from './plugin-network';
import { marketConfigSchema, marketIndexSchema, type MarketConfig } from '@umbrae-labs/lunar-plugin-sdk/manifest';
import {
  jwkThumbprint,
  parsePackageSignature,
  verifyPackageSignature,
  type Sha256,
} from '@umbrae-labs/lunar-plugin-sdk/package-format';
import { strFromU8, strToU8 } from 'fflate';
import { verifyEd25519 } from './plugin-signature';
import type { CatalogFetch, MarketListing } from './plugin-catalog';

/** The build selects the HTTPS endpoint that may delegate index signing and download hosting. */
export async function fetchMarketConfig(endpoint: string, request: CatalogFetch): Promise<MarketConfig> {
  const location = new URL(endpoint);
  if (location.protocol !== 'https:' || location.username || location.password)
    throw new Error('Invalid market config URL');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await request(endpoint, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`Market configuration: HTTP ${response.status}`);
    const source = new URL(response.url || endpoint);
    if (source.protocol !== 'https:') throw new Error('Market configuration requires HTTPS');
    const bytes = await readResponseBytes(response, 16 * 1024);
    const config = marketConfigSchema.parse(JSON.parse(strFromU8(bytes)));
    return { ...config, indexUrl: new URL(config.indexUrl, source.href).href };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchMarket(
  config: MarketConfig,
  request: CatalogFetch,
  sha256: Sha256,
): Promise<MarketListing[]> {
  const response = await request(config.indexUrl);
  if (!response.ok) throw new Error(`Plugin market: HTTP ${response.status}`);
  const bytes = await readResponseBytes(response, 1024 * 1024);
  const { payload, signature: raw } = JSON.parse(strFromU8(bytes));
  const signature = parsePackageSignature(JSON.stringify(raw));
  if (
    typeof payload !== 'string' ||
    !signature ||
    (await verifyPackageSignature(strToU8(payload), signature, config.publicKey, sha256, verifyEd25519))
  )
    throw new Error('Invalid plugin market signature');
  const index = marketIndexSchema.parse(JSON.parse(payload));
  return Promise.all(
    index.plugins.map(async (entry) => ({
      entry,
      publisher: {
        key: entry.publisherKey,
        keyId: await jwkThumbprint(entry.publisherKey, sha256),
        catalogName: 'Lunar',
      },
    })),
  );
}
