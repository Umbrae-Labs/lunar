import type { Sha256 } from '@umbrae-labs/lunar-plugin-sdk/package-format';

import { pluginErrorMessage } from '../domain/plugin-error';
import { fetchPluginCatalog, type CatalogFetch, type FetchedCatalog } from './plugin-catalog';

export type CatalogStatus =
  | { readonly state: 'loading'; readonly previous?: FetchedCatalog }
  | { readonly state: 'ready'; readonly fetched: FetchedCatalog; readonly at: number }
  /** `keyChanged`: the catalog now names another signing key than the one pinned when it was added. */
  | { readonly state: 'failed'; readonly error: string; readonly keyChanged: boolean; readonly at: number };

interface CatalogSubscriptionRef {
  readonly url: string;
  readonly keyId: string;
}

export type CatalogDetails = Pick<FetchedCatalog['catalog'], 'name' | 'badge' | 'website'>;

const STALE_MS = 15 * 60_000;

/** Session cache of fetched catalog indexes; nothing here outlives the process. */
export class PluginCatalogCache {
  private statuses: ReadonlyMap<string, CatalogStatus> = new Map();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly deps: { readonly fetch: CatalogFetch; readonly sha256: Sha256; readonly now?: () => number },
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ReadonlyMap<string, CatalogStatus> => this.statuses;

  /** Fetches catalogs that are stale or failed, or all of them when forced. */
  async refresh(
    catalogs: readonly CatalogSubscriptionRef[],
    force: boolean,
    onDetails?: (url: string, details: CatalogDetails) => void,
  ): Promise<void> {
    const now = this.now();
    const due = catalogs.filter((catalog) => {
      const status = this.statuses.get(catalog.url);
      if (status?.state === 'loading') return false;
      return force || !status || now - status.at > STALE_MS;
    });
    await Promise.all(due.map((catalog) => this.load(catalog, onDetails)));
  }

  /** Drops catalogs the user removed. */
  retain(urls: readonly string[]): void {
    const next = new Map([...this.statuses].filter(([url]) => urls.includes(url)));
    if (next.size !== this.statuses.size) this.publish(next);
  }

  private async load(catalog: CatalogSubscriptionRef, onDetails?: (url: string, details: CatalogDetails) => void) {
    const current = this.statuses.get(catalog.url);
    this.set(catalog.url, { state: 'loading', previous: current?.state === 'ready' ? current.fetched : undefined });
    try {
      const fetched = await fetchPluginCatalog(catalog.url, this.deps.fetch, this.deps.sha256);
      if (fetched.keyId !== catalog.keyId) {
        this.set(catalog.url, { state: 'failed', error: 'keyChanged', keyChanged: true, at: this.now() });
        return;
      }
      this.set(catalog.url, { state: 'ready', fetched, at: this.now() });
      const { name, badge, website } = fetched.catalog;
      onDetails?.(catalog.url, { name, badge, website });
    } catch (error) {
      this.set(catalog.url, { state: 'failed', error: pluginErrorMessage(error), keyChanged: false, at: this.now() });
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private set(url: string, status: CatalogStatus) {
    this.publish(new Map(this.statuses).set(url, status));
  }

  private publish(next: ReadonlyMap<string, CatalogStatus>) {
    this.statuses = next;
    for (const listener of [...this.listeners]) listener();
  }
}
