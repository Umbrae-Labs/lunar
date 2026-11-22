import { parsePluginManifest, satisfiesVersionRange, SDK_VERSION } from '@umbrae-labs/lunar-plugin-sdk/manifest';

import type { InstalledPlugin, PluginLogEntry } from '../domain/installed-plugin';
import { LunarPluginError } from '../domain/plugin-error';

export const DEV_POLL_INTERVAL_MS = 1_000;
export const DEV_LOG_FLUSH_MS = 300;
const MaxQueuedLogs = 200;

export interface DevSessionStatus {
  readonly url: string;
  readonly state: 'connecting' | 'connected' | 'error';
  readonly pluginId?: string;
  readonly revision?: number;
  readonly error?: string;
}

export interface DevSessionDependencies {
  readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
  readonly locales: () => readonly string[];
  readonly onPlugin: (plugin: InstalledPlugin) => void;
  readonly onStatus: (status: DevSessionStatus | undefined) => void;
  readonly onStop: (pluginId: string | undefined) => void;
  readonly now?: () => number;
}

/**
 * Follows a `lunar-plugin dev` server on the local network. Every revision is
 * fetched and handed to the host as a development plugin kept in memory, and
 * the plugin's log is sent back to the developer's terminal.
 */
export class PluginDevSession {
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private logTimer?: ReturnType<typeof setTimeout>;
  private readonly logQueue: PluginLogEntry[] = [];
  private revision = -1;
  private pluginId?: string;
  private readonly base: URL;
  private readonly token: string;

  constructor(
    readonly url: string,
    private readonly deps: DevSessionDependencies,
  ) {
    const parsed = parseDevServerUrl(url);
    this.base = parsed.base;
    this.token = parsed.token;
  }

  start(): void {
    this.deps.onStatus({ url: this.url, state: 'connecting' });
    void this.poll();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.logTimer) clearTimeout(this.logTimer);
    this.logQueue.length = 0;
    this.deps.onStatus(undefined);
    this.deps.onStop(this.pluginId);
  }

  /** Queues a log entry for the terminal; entries go out in small batches. */
  sendLog(entry: PluginLogEntry): void {
    if (this.stopped) return;
    this.logQueue.push(entry);
    if (this.logQueue.length > MaxQueuedLogs) this.logQueue.splice(0, this.logQueue.length - MaxQueuedLogs);
    this.logTimer ??= setTimeout(() => void this.flushLogs(), DEV_LOG_FLUSH_MS);
  }

  private async flushLogs(): Promise<void> {
    this.logTimer = undefined;
    const entries = this.logQueue.splice(0);
    if (entries.length === 0 || this.stopped) return;
    try {
      await this.deps.fetch(this.endpoint('/logs'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries }),
      });
    } catch {
      // The terminal copy is a convenience; the plugin page keeps the full log.
    }
  }

  private endpoint(path: string): string {
    const url = new URL(path, this.base);
    url.searchParams.set('token', this.token);
    return url.href;
  }

  private async poll(): Promise<void> {
    try {
      const response = await this.deps.fetch(this.endpoint('/version'));
      if (!response.ok)
        throw new Error(response.status === 403 ? 'The pairing token was rejected' : `HTTP ${response.status}`);
      const version = (await response.json()) as { revision?: unknown; error?: unknown };
      if (this.stopped) return;
      if (typeof version.error === 'string') {
        this.deps.onStatus({ url: this.url, state: 'error', pluginId: this.pluginId, error: version.error });
      } else if (typeof version.revision === 'number' && version.revision !== this.revision) {
        await this.load(version.revision);
      }
    } catch (error) {
      if (!this.stopped) {
        this.deps.onStatus({
          url: this.url,
          state: 'error',
          pluginId: this.pluginId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(), DEV_POLL_INTERVAL_MS);
  }

  private async load(revision: number): Promise<void> {
    const [manifestResponse, entryResponse] = await Promise.all([
      this.deps.fetch(this.endpoint('/manifest.json')),
      this.deps.fetch(this.endpoint('/main.js')),
    ]);
    if (!manifestResponse.ok || !entryResponse.ok) throw new Error('The development build is not ready');
    const parsed = parsePluginManifest(await manifestResponse.json());
    if (!parsed.ok) throw new Error(`manifest.json is invalid: ${parsed.issues.join('; ')}`);
    const manifest = parsed.manifest;
    if (!satisfiesVersionRange(SDK_VERSION, manifest.sdk)) {
      throw new LunarPluginError('INCOMPATIBLE_SDK', `The plugin needs SDK ${manifest.sdk}`);
    }
    if (this.pluginId && this.pluginId !== manifest.id) throw new Error('The development server switched plugins');
    const entry = await entryResponse.text();
    const locales: Record<string, Record<string, string>> = {};
    for (const locale of new Set([...this.deps.locales(), 'en', manifest.defaultLocale ?? 'zh-CN'])) {
      const response = await this.deps.fetch(this.endpoint(`/locales/${encodeURIComponent(locale)}.json`));
      if (response.ok) locales[locale] = (await response.json()) as Record<string, string>;
    }
    if (this.stopped) return;
    const now = this.deps.now?.() ?? Date.now();
    this.pluginId = manifest.id;
    this.revision = revision;
    this.deps.onPlugin({
      id: manifest.id,
      version: manifest.version,
      source: 'development',
      manifest,
      locales,
      installedAt: now,
      updatedAt: now,
      inlineEntry: entry,
    });
    this.deps.onStatus({ url: this.url, state: 'connected', pluginId: manifest.id, revision });
  }
}

/** Accepts the address printed by `lunar-plugin dev`, including its pairing token. */
export function parseDevServerUrl(value: string): { readonly base: URL; readonly token: string } {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new LunarPluginError('INVALID_ARGUMENT', 'Enter the full address printed by lunar-plugin dev');
  }
  const token = url.searchParams.get('token');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LunarPluginError('INVALID_ARGUMENT', 'The address must start with http:// or https://');
  }
  if (!token || !/^[0-9a-f]{32}$/.test(token)) {
    throw new LunarPluginError('INVALID_ARGUMENT', 'The address is missing its pairing token');
  }
  return { base: new URL(`${url.protocol}//${url.host}/`), token };
}
