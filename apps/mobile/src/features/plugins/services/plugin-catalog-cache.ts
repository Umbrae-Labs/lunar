import { pluginErrorMessage } from '../domain/plugin-error';
import type { MarketListing } from './plugin-catalog';

interface MarketStatus {
  readonly entries: readonly MarketListing[];
  readonly loading: boolean;
  readonly error?: string;
}

/** Shared by the plugin manager's update badges and the market screen. */
export class PluginMarketCache {
  private status: MarketStatus = { entries: [], loading: false };
  private refreshed = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly load: () => Promise<readonly MarketListing[]>) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.status;
  refresh = async (force = false) => {
    if (this.status.loading || (!force && Date.now() - this.refreshed < 15 * 60_000)) return;
    this.set({ ...this.status, loading: true, error: undefined });
    try {
      const entries = await this.load();
      this.refreshed = Date.now();
      this.set({ entries, loading: false });
    } catch (error) {
      this.set({ entries: [], loading: false, error: pluginErrorMessage(error) });
    }
  };
  private set(status: MarketStatus) {
    this.status = status;
    for (const listener of this.listeners) listener();
  }
}
