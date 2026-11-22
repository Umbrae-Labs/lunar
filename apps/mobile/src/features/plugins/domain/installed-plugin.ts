import type { PluginSource } from '@umbrae-labs/lunar-plugin-sdk';
import type { PluginManifest } from '@umbrae-labs/lunar-plugin-sdk/manifest';

export type PluginLocales = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** A plugin the host can run: an installed package or a live development build. */
export interface InstalledPlugin {
  readonly id: string;
  readonly version: string;
  readonly source: PluginSource;
  readonly manifest: PluginManifest;
  readonly locales: PluginLocales;
  readonly installedAt: number;
  readonly updatedAt: number;
  /** Installed packages only. */
  readonly directoryUri?: string;
  readonly packageSha256?: string;
  readonly entrySha256?: string;
  /**
   * JWK thumbprint of the key whose signature was verified at installation. Later versions must be
   * signed by the same key.
   */
  readonly signerKeyId?: string;
  /** Development builds keep their entry in memory instead of on disk. */
  readonly inlineEntry?: string;
  /**
   * The version an update replaced. It stays installed until this version first
   * activates, and is restored when that activation fails.
   */
  readonly previous?: InstalledPlugin;
}

/** Why a plugin is not running the version the user last installed. */
export interface PluginNotice {
  readonly kind: 'reverted';
  readonly failedVersion: string;
  readonly restoredVersion: string;
  readonly reason: string;
}

export type PluginRunState = 'idle' | 'activating' | 'active' | 'failed';

export interface PluginStatus {
  readonly plugin: InstalledPlugin;
  readonly enabled: boolean;
  readonly state: PluginRunState;
  readonly generation: number;
  readonly error?: string;
  readonly activationMs?: number;
  /** A newer version was installed while this one had already run; it applies after a restart. */
  readonly pendingVersion?: string;
  readonly notice?: PluginNotice;
}

export interface PluginLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly at: number;
}
