import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { sha256Hex } from '../infrastructure/expo-plugin-files';
import { usePluginRuntime } from '../components/plugin-runtime-provider';
import { listCatalogOffers, type CatalogOffer } from '../services/plugin-catalog';
import { PluginMarketCache } from '../services/plugin-catalog-cache';
import { fetchMarket, fetchMarketConfig } from '../services/plugin-market';
import { downloadGithubPlugin, downloadReleaseAsset } from '../services/github-release';

const request = (url: string, init?: RequestInit) => fetch(url, { cache: 'no-store', ...init } as RequestInit);
const configUrl = process.env.EXPO_PUBLIC_PLUGIN_MARKET_CONFIG_URL;
const loadConfig = () => (configUrl ? fetchMarketConfig(configUrl, request) : Promise.resolve(undefined));
const cache = new PluginMarketCache(async () => {
  const config = await loadConfig();
  return config ? fetchMarket(config, request, sha256Hex) : [];
});

async function currentMirror() {
  // A reviewed asset has a pinned digest. GitHub is also usable without the optional mirror.
  try {
    return (await loadConfig())?.githubMirror;
  } catch {
    return undefined;
  }
}

export async function downloadGithub(url: string) {
  return downloadGithubPlugin(url, request, sha256Hex, await currentMirror());
}

export async function downloadOffer(offer: CatalogOffer) {
  const { entry, publisher } = offer;
  const archive = await downloadReleaseAsset(
    { url: entry.package, size: entry.size, sha256: entry.sha256 },
    request,
    sha256Hex,
    await currentMirror(),
  );
  return { archive, market: { id: entry.id, version: entry.version, publisher } };
}

export function usePluginCatalogs() {
  const { host } = usePluginRuntime();
  const status = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  const pluginStatuses = useSyncExternalStore(host.subscribe, host.getStatuses);
  useEffect(() => {
    void cache.refresh();
  }, []);
  const offers = useMemo(
    () =>
      listCatalogOffers(
        status.entries,
        pluginStatuses.map((status) => status.plugin),
      ),
    [status.entries, pluginStatuses],
  );
  return { offers, refresh: cache.refresh, error: status.error, isRefreshing: status.loading };
}
