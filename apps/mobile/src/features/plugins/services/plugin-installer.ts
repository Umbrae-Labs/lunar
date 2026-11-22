import { compareVersions } from '@umbrae-labs/lunar-plugin-sdk/manifest';
import {
  verifyPackageSignature,
  type Ed25519PublicJwk,
  type Sha256,
  type VerifyEd25519,
} from '@umbrae-labs/lunar-plugin-sdk/package-format';

import type { InstalledPlugin } from '../domain/installed-plugin';
import { LunarPluginError } from '../domain/plugin-error';
import type { PluginRecordRepository, PluginStorageRepository } from '../repositories/plugin-repository';
import { readPluginPackage, type PluginPackage } from './plugin-package';

export interface PluginFileStore {
  write(pluginId: string, version: string, files: ReadonlyMap<string, Uint8Array>): string;
  /** Removes the plugin's versions other than `keepVersions`, or all of them. */
  remove(pluginId: string, keepVersions?: readonly string[]): void;
}

/** A signing key the user trusts by having added the catalog that publishes it. */
export interface TrustedSigningKey {
  readonly keyId: string;
  readonly key: Ed25519PublicJwk;
  readonly catalogName: string;
}

/** What the package signature establishes about who published the package. */
export type PluginTrust =
  | { readonly kind: 'verified'; readonly keyId: string; readonly catalogName: string }
  /** Signed with a key no added catalog publishes, so the signature cannot be checked. */
  | { readonly kind: 'unknownKey'; readonly keyId: string }
  | { readonly kind: 'unsigned' };

export interface PluginInstallerDependencies {
  readonly records: PluginRecordRepository;
  readonly storage: PluginStorageRepository;
  readonly files: PluginFileStore;
  readonly sha256: Sha256;
  /** Keys of the added catalogs; without them every package counts as unsigned. */
  readonly trustedKeys?: () => readonly TrustedSigningKey[];
  readonly verify?: VerifyEd25519;
  readonly now?: () => number;
}

export type PluginInstallKind = 'install' | 'update' | 'downgrade' | 'reinstall';

/** A validated package awaiting the user's confirmation. */
export interface PluginInstallPreview {
  readonly package: PluginPackage;
  readonly kind: PluginInstallKind;
  readonly current?: InstalledPlugin;
  /** Permissions the installed version did not request. */
  readonly addedPermissions: readonly string[];
  /** The new version stores data in another format; its first start converts the data. */
  readonly migratesData: boolean;
  readonly trust: PluginTrust;
}

export class PluginInstaller {
  constructor(private readonly deps: PluginInstallerDependencies) {}

  async inspect(archive: Uint8Array): Promise<PluginInstallPreview> {
    const pluginPackage = await readPluginPackage(archive, this.deps.sha256);
    const manifest = pluginPackage.manifest;
    const current = (await this.deps.records.list()).find((plugin) => plugin.id === manifest.id);
    if (current && current.version === manifest.version && current.packageSha256 !== pluginPackage.packageSha256) {
      throw new LunarPluginError(
        'INTEGRITY_FAILED',
        `Version ${manifest.version} is already installed with different contents; publish a new version`,
      );
    }
    const trust = await this.checkTrust(pluginPackage);
    if (current?.signerKeyId && (trust.kind !== 'verified' || trust.keyId !== current.signerKeyId)) {
      throw new LunarPluginError(
        'INTEGRITY_FAILED',
        trust.kind === 'unknownKey' && trust.keyId === current.signerKeyId
          ? 'The catalog that publishes this plugin has been removed; add it again to update the plugin'
          : `The installed plugin was signed with key ${current.signerKeyId}; uninstall it before installing a package from another publisher`,
      );
    }
    const order = current ? compareVersions(manifest.version, current.version) : 1;
    const known = new Set(current?.manifest.permissions.map((item) => item.name) ?? []);
    return {
      package: pluginPackage,
      current,
      kind: !current ? 'install' : order > 0 ? 'update' : order < 0 ? 'downgrade' : 'reinstall',
      addedPermissions: manifest.permissions.map((item) => item.name).filter((name) => !known.has(name)),
      migratesData: current !== undefined && current.manifest.dataVersion !== manifest.dataVersion,
      trust,
    };
  }

  private async checkTrust(pluginPackage: PluginPackage): Promise<PluginTrust> {
    const signature = pluginPackage.signature;
    if (!signature) return { kind: 'unsigned' };
    const trusted = this.deps.trustedKeys?.().find((item) => item.keyId === signature.keyId);
    if (!trusted || !this.deps.verify) return { kind: 'unknownKey', keyId: signature.keyId };
    const problem = await verifyPackageSignature(
      pluginPackage.integrityBytes,
      signature,
      trusted.key,
      this.deps.sha256,
      this.deps.verify,
    );
    if (problem) throw new LunarPluginError('INTEGRITY_FAILED', `Signature check failed: ${problem}`);
    return { kind: 'verified', keyId: trusted.keyId, catalogName: trusted.catalogName };
  }

  /**
   * Writes the package and its record. A replaced version stays installed as
   * `previous` until the new version first activates; an update that never
   * activated is skipped over, so `previous` is always a version that ran.
   */
  async install(preview: PluginInstallPreview): Promise<InstalledPlugin> {
    const { manifest, files, locales, packageSha256, entrySha256 } = preview.package;
    const now = this.deps.now?.() ?? Date.now();
    const current = preview.current;
    const previous =
      current && current.version !== manifest.version ? (current.previous ?? current) : current?.previous;
    const directoryUri = this.deps.files.write(manifest.id, manifest.version, files);
    const plugin: InstalledPlugin = {
      id: manifest.id,
      version: manifest.version,
      // Lunar has no first-party catalog: every installed package is a community package.
      source: 'community',
      manifest,
      locales,
      directoryUri,
      packageSha256,
      entrySha256,
      signerKeyId: preview.trust.kind === 'verified' ? preview.trust.keyId : undefined,
      installedAt: current?.installedAt ?? now,
      updatedAt: now,
      previous: previous && previous.version !== manifest.version ? { ...previous, previous: undefined } : undefined,
    };
    try {
      await this.deps.records.save(plugin);
    } catch (error) {
      if (current && current.version !== manifest.version)
        this.deps.files.remove(manifest.id, installedVersions(current));
      throw error;
    }
    return plugin;
  }

  /** The update activated: its replaced version is no longer needed. */
  async commit(plugin: InstalledPlugin): Promise<InstalledPlugin> {
    const committed: InstalledPlugin = { ...plugin, previous: undefined };
    await this.deps.records.save(committed);
    this.deps.files.remove(plugin.id, [plugin.version]);
    return committed;
  }

  /** The update failed to activate: the replaced version becomes current again. */
  async revert(plugin: InstalledPlugin): Promise<InstalledPlugin | undefined> {
    const previous = plugin.previous;
    if (!previous) return undefined;
    await this.deps.records.save(previous);
    this.deps.files.remove(plugin.id, [previous.version]);
    return previous;
  }

  /** Removes versions that no record refers to any more. */
  cleanUp(plugin: InstalledPlugin): void {
    this.deps.files.remove(plugin.id, installedVersions(plugin));
  }

  async uninstall(pluginId: string, keepData: boolean): Promise<void> {
    await this.deps.records.remove(pluginId);
    this.deps.files.remove(pluginId);
    if (!keepData) await this.deps.storage.clear(pluginId);
  }
}

function installedVersions(plugin: InstalledPlugin): readonly string[] {
  return plugin.previous ? [plugin.version, plugin.previous.version] : [plugin.version];
}
