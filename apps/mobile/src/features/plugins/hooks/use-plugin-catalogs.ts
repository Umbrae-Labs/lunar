import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { usePluginStore } from '@/stores';
import { sha256Hex } from '../infrastructure/expo-plugin-files';
import { usePluginRuntime } from '../components/plugin-runtime-provider';
import {
  downloadCatalogPackage,
  fetchPluginCatalog,
  listCatalogOffers,
  type CatalogOffer,
} from '../services/plugin-catalog';
import { PluginCatalogCache, type CatalogDetails } from '../services/plugin-catalog-cache';

const catalogFetch = (url: string, init?: RequestInit) => fetch(url, { cache: 'no-store', ...init } as RequestInit);
const cache = new PluginCatalogCache({ fetch: catalogFetch, sha256: sha256Hex });

/** Fetches an index that is not added yet, to show the user what they are about to trust. */
export function inspectPluginCatalog(url: string) {
  return fetchPluginCatalog(url, catalogFetch, sha256Hex);
}

export function downloadOffer(offer: CatalogOffer): Promise<Uint8Array> {
  return downloadCatalogPackage(offer.catalogUrl, offer.entry, catalogFetch, sha256Hex);
}

/** The added catalogs, their fetch state, and what they offer against the installed plugins. */
export function usePluginCatalogs() {
  const { host } = usePluginRuntime();
  const subscriptions = usePluginStore((state) => state.catalogs);
  const updateCatalog = usePluginStore((state) => state.updateCatalog);
  const statuses = useSyncExternalStore(cache.subscribe, cache.getSnapshot);
  const pluginStatuses = useSyncExternalStore(host.subscribe, host.getStatuses);

  const refresh = useCallback(
    (force = false) => {
      cache.retain(subscriptions.map((catalog) => catalog.url));
      return cache.refresh(subscriptions, force, (url, details: CatalogDetails) => {
        const current = subscriptions.find((catalog) => catalog.url === url);
        if (
          current &&
          (current.name !== details.name || current.badge !== details.badge || current.website !== details.website)
        ) {
          updateCatalog(url, details);
        }
      });
    },
    [subscriptions, updateCatalog],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const offers = useMemo(
    () =>
      listCatalogOffers(
        subscriptions.flatMap((subscription) => {
          const status = statuses.get(subscription.url);
          const fetched =
            status?.state === 'ready' ? status.fetched : status?.state === 'loading' ? status.previous : undefined;
          return fetched ? [{ ...fetched, name: subscription.name, badge: subscription.badge }] : [];
        }),
        pluginStatuses.map((status) => status.plugin),
      ),
    [pluginStatuses, statuses, subscriptions],
  );

  return {
    subscriptions,
    statuses,
    offers,
    refresh,
    isRefreshing: subscriptions.some((catalog) => statuses.get(catalog.url)?.state === 'loading'),
  };
}
