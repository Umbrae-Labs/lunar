import { createHash, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { zipSync } from 'fflate';
import { parsePluginManifest, type PluginManifest, type PluginManifestInput } from '@umbrae-labs/lunar-plugin-sdk/manifest';
import {
  base64UrlEncode,
  createIntegrityManifest,
  jwkThumbprint,
  parseEd25519PublicJwk,
  serializeIntegrityManifest,
  serializePackageSignature,
  type Ed25519PublicJwk,
} from '@umbrae-labs/lunar-plugin-sdk/package-format';
import { vi } from 'vitest';

import type { InstalledPlugin } from '../../src/features/plugins/domain/installed-plugin';
import type { PluginStorageRepository } from '../../src/features/plugins/repositories/plugin-repository';
import { PluginHost, type PluginHostDependencies } from '../../src/features/plugins/services/plugin-host';

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const encoder = new TextEncoder();

export function manifest(patch: Partial<PluginManifestInput> = {}): PluginManifest {
  const result = parsePluginManifest({
    manifestVersion: 1,
    id: 'org.example.test',
    name: '%name%',
    version: '1.0.0',
    sdk: '^0.1.0',
    trust: 'full',
    main: 'main.js',
    permissions: [
      { name: 'reader.events', reason: 'events' },
      { name: 'reader.selection.read', reason: 'selection' },
      { name: 'reader.content.read', reason: 'content' },
      { name: 'reader.navigate', reason: 'navigate' },
      { name: 'reader.decorations', reason: 'decorations' },
    ],
    contributes: {
      commands: [{ id: 'run', title: 'Run' }],
      slots: {
        'reader.toolbar': [{ id: 'button', command: 'run', icon: 'star' }],
        'reader.panel': [{ id: 'panel', title: '%panel%', icon: 'chart' }],
      },
      settings: [{ key: 'limit', type: 'number', title: 'Limit', default: 10, min: 1, max: 20 }],
    },
    ...patch,
  });
  if (!result.ok) throw new Error(result.issues.join('\n'));
  return result.manifest;
}

export function plugin(entry: string, patch: Partial<InstalledPlugin> = {}): InstalledPlugin {
  const pluginManifest = patch.manifest ?? manifest();
  return {
    id: pluginManifest.id,
    version: pluginManifest.version,
    source: 'community',
    manifest: pluginManifest,
    locales: { 'zh-CN': { name: '测试', panel: '面板' }, en: { name: 'Test', panel: 'Panel' } },
    installedAt: 1,
    updatedAt: 1,
    inlineEntry: entry,
    ...patch,
  };
}

export function memoryStorage(): PluginStorageRepository & {
  readonly data: Map<string, string>;
  readonly versions: Map<string, number>;
} {
  const data = new Map<string, string>();
  const versions = new Map<string, number>();
  const backups = new Map<string, { readonly version: number; readonly data: Map<string, string> }>();
  const id = (pluginId: string, key: string) => `${pluginId}\u0000${key}`;
  const owned = (pluginId: string) => [...data.keys()].filter((key) => key.startsWith(`${pluginId}\u0000`));
  return {
    data,
    versions,
    get: async (pluginId, key) => data.get(id(pluginId, key)),
    set: async (pluginId, key, value) => {
      data.set(id(pluginId, key), value);
    },
    delete: async (pluginId, key) => {
      data.delete(id(pluginId, key));
    },
    keys: async (pluginId, prefix = '') =>
      [...data.keys()]
        .filter((key) => key.startsWith(`${pluginId}\u0000${prefix}`))
        .map((key) => key.slice(pluginId.length + 1)),
    totalBytes: async (pluginId, excluding) =>
      [...data.entries()]
        .filter(([key]) => key.startsWith(`${pluginId}\u0000`) && key !== id(pluginId, excluding ?? '\u0001'))
        .reduce((sum, [, value]) => sum + value.length, 0),
    clear: async (pluginId) => {
      for (const key of owned(pluginId)) data.delete(key);
      versions.delete(pluginId);
      backups.delete(pluginId);
    },
    getDataVersion: async (pluginId) => versions.get(pluginId),
    setDataVersion: async (pluginId, version) => {
      versions.set(pluginId, version);
    },
    snapshot: async (pluginId) => {
      backups.set(pluginId, {
        version: versions.get(pluginId) ?? 1,
        data: new Map(owned(pluginId).map((key) => [key, data.get(key)!])),
      });
      if (!versions.has(pluginId)) versions.set(pluginId, 1);
    },
    restoreSnapshot: async (pluginId) => {
      const backup = backups.get(pluginId);
      if (!backup) return false;
      for (const key of owned(pluginId)) data.delete(key);
      for (const [key, value] of backup.data) data.set(key, value);
      versions.set(pluginId, backup.version);
      backups.delete(pluginId);
      return true;
    },
    dropSnapshot: async (pluginId) => {
      backups.delete(pluginId);
    },
  };
}

export function createTestHost(patch: Partial<PluginHostDependencies> = {}) {
  const settings = new Map<string, unknown>();
  const settingListeners = new Set<() => void>();
  const deps = {
    modules: { '@umbrae-labs/lunar-plugin-sdk': { definePlugin: (definition: unknown) => definition } },
    readEntry: vi.fn(async () => {
      throw new Error('no installed entry');
    }),
    settings: {
      get: (pluginId: string, key: string) => settings.get(`${pluginId}/${key}`) as never,
      set: (pluginId: string, key: string, value: unknown) => {
        settings.set(`${pluginId}/${key}`, value);
        settingListeners.forEach((listener) => listener());
      },
      subscribe: (listener: () => void) => {
        settingListeners.add(listener);
        return () => settingListeners.delete(listener);
      },
    },
    storage: memoryStorage(),
    network: vi.fn(),
    library: {
      importEpub: vi.fn(async () => ({ id: 'book-1', title: 'Imported', author: '', language: 'zh-CN' })),
    },
    clipboard: vi.fn(async () => undefined),
    ui: { toast: vi.fn(), confirm: vi.fn(async () => true), openRoute: vi.fn() },
    hostInfo: () => ({
      appVersion: '0.3.0',
      platform: 'android' as const,
      locale: 'zh-CN',
      colorScheme: 'light' as const,
    }),
    markActivation: vi.fn(),
    onAutoDisabled: vi.fn(),
    schedule: (task: () => void) => task(),
    ...patch,
  } satisfies PluginHostDependencies;
  return { host: new PluginHost(deps), deps };
}

/** Builds a `.lunar-plugin` archive the way the CLI does. */
export interface TestSigningKey {
  readonly privateKey: KeyObject;
  readonly jwk: Ed25519PublicJwk;
  readonly keyId: string;
}

/** An Ed25519 key made with Node.js, the way the plugin CLI makes them. */
export async function createSigningKey(): Promise<TestSigningKey> {
  const { privateKey } = generateKeyPairSync('ed25519');
  const jwk = parseEd25519PublicJwk(createPublicKey(privateKey).export({ format: 'jwk' }))!;
  return { privateKey, jwk, keyId: await jwkThumbprint(jwk, sha256) };
}

export async function packArchive(
  files: Record<string, string | Uint8Array>,
  options: {
    readonly integrity?: boolean;
    /** Signs integrity.json; `keyId` overrides the key id the signature names. */
    readonly signWith?: TestSigningKey;
    readonly keyId?: string;
  } = {},
): Promise<Uint8Array> {
  const bytes = new Map(
    Object.entries(files).map(([path, value]) => [path, typeof value === 'string' ? encoder.encode(value) : value]),
  );
  if (options.integrity !== false) {
    const integrity = await createIntegrityManifest(
      [...bytes].map(([path, data]) => ({ path, bytes: data })),
      sha256,
    );
    bytes.set('integrity.json', encoder.encode(serializeIntegrityManifest(integrity)));
  }
  if (options.signWith) {
    const signature = sign(null, bytes.get('integrity.json')!, options.signWith.privateKey);
    bytes.set(
      'signature.json',
      encoder.encode(
        serializePackageSignature({
          format: 1,
          algorithm: 'Ed25519',
          keyId: options.keyId ?? options.signWith.keyId,
          signature: base64UrlEncode(new Uint8Array(signature)),
        }),
      ),
    );
  }
  return zipSync(Object.fromEntries(bytes));
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
