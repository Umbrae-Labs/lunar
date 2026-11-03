import { describe, expect, it } from 'vitest';
import type { PluginCatalog } from '@umbrae-labs/lunar-plugin-sdk/manifest';

import type { InstalledPlugin } from '../../src/features/plugins/domain/installed-plugin';
import type { PluginRecordRepository } from '../../src/features/plugins/repositories/plugin-repository';
import { redirectCatalogLink } from '../../src/features/plugins/services/catalog-link';
import {
  downloadCatalogPackage,
  fetchPluginCatalog,
  listCatalogOffers,
  localizeCatalogEntry,
  resolveCatalogUrl,
  type FetchedCatalog,
} from '../../src/features/plugins/services/plugin-catalog';
import { PluginCatalogCache } from '../../src/features/plugins/services/plugin-catalog-cache';
import { PluginInstaller, type TrustedSigningKey } from '../../src/features/plugins/services/plugin-installer';
import { readPluginPackage } from '../../src/features/plugins/services/plugin-package';
import { verifyEd25519 } from '../../src/features/plugins/services/plugin-signature';
import {
  createSigningKey,
  manifest,
  memoryStorage,
  packArchive,
  plugin,
  sha256,
  type TestSigningKey,
} from './plugin-test-support';

const id = 'org.example.test';
const files = (version = '1.0.0', patch = {}) => ({
  'manifest.json': JSON.stringify({ ...manifest({ version, ...patch }), name: 'Test' }),
  'main.js': 'exports.default = { activate() {} };',
});

describe('plugin package signatures', () => {
  it('exposes a well-formed signature and rejects a malformed one', async () => {
    const key = await createSigningKey();
    const signed = await readPluginPackage(await packArchive(files(), { signWith: key }), sha256);
    expect(signed.signature?.keyId).toBe(key.keyId);
    await expect(
      readPluginPackage(await packArchive({ ...files(), 'signature.json': '{"format":1}' }), sha256),
    ).rejects.toThrow('signature.json is invalid');
  });

  it('requires the key the manifest names as publisher', async () => {
    const key = await createSigningKey();
    const other = await createSigningKey();
    const pinned = files('1.0.0', { publisherKeyId: key.keyId });
    await expect(readPluginPackage(await packArchive(pinned), sha256)).rejects.toThrow('publisher key');
    await expect(readPluginPackage(await packArchive(pinned, { signWith: other }), sha256)).rejects.toThrow(
      'publisher key',
    );
    expect((await readPluginPackage(await packArchive(pinned, { signWith: key }), sha256)).signature).toBeDefined();
  });
});

describe('plugin installer trust', () => {
  function setup(trusted: readonly TestSigningKey[]) {
    const records = new Map<string, InstalledPlugin>();
    const repository: PluginRecordRepository = {
      list: async () => [...records.values()],
      save: async (record) => {
        records.set(record.id, record);
      },
      remove: async (pluginId) => {
        records.delete(pluginId);
      },
    };
    const installer = new PluginInstaller({
      records: repository,
      storage: memoryStorage(),
      sha256: async (bytes) => sha256(bytes),
      trustedKeys: () =>
        trusted.map((key): TrustedSigningKey => ({ keyId: key.keyId, key: key.jwk, catalogName: 'Example' })),
      verify: verifyEd25519,
      files: { write: (pluginId, version) => `file:///plugins/${pluginId}/${version}`, remove: () => undefined },
    });
    return { installer, records };
  }

  it('verifies packages signed with a trusted key using the RFC 8032 verifier', async () => {
    const key = await createSigningKey();
    const { installer, records } = setup([key]);
    const preview = await installer.inspect(await packArchive(files(), { signWith: key }));
    expect(preview.trust).toEqual({ kind: 'verified', keyId: key.keyId, catalogName: 'Example' });
    await installer.install(preview);
    expect(records.get(id)?.signerKeyId).toBe(key.keyId);
  });

  it('reports untrusted keys and unsigned packages without verifying them', async () => {
    const key = await createSigningKey();
    const { installer } = setup([]);
    expect((await installer.inspect(await packArchive(files(), { signWith: key }))).trust).toEqual({
      kind: 'unknownKey',
      keyId: key.keyId,
    });
    expect((await installer.inspect(await packArchive(files()))).trust).toEqual({ kind: 'unsigned' });
  });

  it('rejects a signature that claims a trusted key it was not made with', async () => {
    const trusted = await createSigningKey();
    const forger = await createSigningKey();
    const { installer } = setup([trusted]);
    await expect(
      installer.inspect(await packArchive(files(), { signWith: forger, keyId: trusted.keyId })),
    ).rejects.toThrow('Signature check failed');
  });

  it('keeps updates with the key the plugin was installed with', async () => {
    const key = await createSigningKey();
    const other = await createSigningKey();
    const { installer } = setup([key, other]);
    await installer.install(await installer.inspect(await packArchive(files('1.0.0'), { signWith: key })));

    await expect(installer.inspect(await packArchive(files('1.1.0'), { signWith: other }))).rejects.toThrow(
      'another publisher',
    );
    await expect(installer.inspect(await packArchive(files('1.1.0')))).rejects.toThrow('another publisher');
    expect((await installer.inspect(await packArchive(files('1.1.0'), { signWith: key }))).kind).toBe('update');
  });
});

describe('plugin catalogs', () => {
  const indexUrl = 'https://example.com/lunar/index.json';

  async function catalogFor(key: TestSigningKey, archive: Uint8Array, patch = {}): Promise<PluginCatalog> {
    return {
      format: 1,
      name: 'Example',
      signingKey: key.jwk,
      plugins: [
        {
          id,
          name: 'Test',
          version: '1.0.0',
          sdk: '^0.1.0',
          package: 'packages/test.lunar-plugin',
          sha256: sha256(archive),
          size: archive.byteLength,
          permissions: [],
          ...patch,
        },
      ],
    };
  }

  const respond =
    (body: string | Uint8Array, status = 200) =>
    async () =>
      new Response(typeof body === 'string' ? body : new Uint8Array(body), { status });

  it('resolves package locations against the index and refuses other schemes', () => {
    expect(resolveCatalogUrl(indexUrl, 'packages/a.lunar-plugin')).toBe(
      'https://example.com/lunar/packages/a.lunar-plugin',
    );
    expect(resolveCatalogUrl(`${indexUrl}?v=2`, '/a.lunar-plugin')).toBe('https://example.com/a.lunar-plugin');
    expect(resolveCatalogUrl(indexUrl, 'https://cdn.example.com/a')).toBe('https://cdn.example.com/a');
    expect(() => resolveCatalogUrl(indexUrl, 'http://example.com/a')).toThrow('HTTPS');
    expect(() => resolveCatalogUrl(indexUrl, '//example.com/a')).toThrow('HTTPS');
  });

  it('fetches an index over HTTPS and computes the key thumbprint', async () => {
    const key = await createSigningKey();
    const catalog = await catalogFor(key, new Uint8Array([1]));
    const fetched = await fetchPluginCatalog(indexUrl, respond(JSON.stringify(catalog)), sha256);
    expect(fetched.keyId).toBe(key.keyId);
    expect(fetched.catalog.plugins).toHaveLength(1);
    await expect(fetchPluginCatalog('http://example.com/index.json', respond('{}'), sha256)).rejects.toThrow(
      'https://',
    );
    await expect(fetchPluginCatalog(indexUrl, respond('<html>'), sha256)).rejects.toThrow('not point to');
    await expect(fetchPluginCatalog(indexUrl, respond('{}', 404), sha256)).rejects.toThrow('HTTP 404');
  });

  it('downloads only the exact package the index lists', async () => {
    const key = await createSigningKey();
    const archive = await packArchive(files(), { signWith: key });
    const [entry] = (await catalogFor(key, archive)).plugins;
    expect(await downloadCatalogPackage(indexUrl, entry!, respond(archive), sha256)).toEqual(archive);
    const changed = new Uint8Array(archive);
    changed[changed.length - 1] ^= 1;
    await expect(downloadCatalogPackage(indexUrl, entry!, respond(changed), sha256)).rejects.toThrow(
      'does not match the catalog',
    );
  });

  it('offers installs and updates, but never another publisher’s package for an installed plugin', async () => {
    const key = await createSigningKey();
    const other = await createSigningKey();
    const fetched = (signing: TestSigningKey, catalog: PluginCatalog): FetchedCatalog & { name: string } => ({
      url: indexUrl,
      catalog,
      keyId: signing.keyId,
      name: 'Example',
    });
    const newer = await catalogFor(key, new Uint8Array([1]), { version: '1.2.0' });
    const installed = [
      plugin('', { manifest: manifest({ version: '1.0.0' }), version: '1.0.0', signerKeyId: key.keyId }),
    ];

    expect(listCatalogOffers([fetched(key, newer)], []).map((offer) => offer.state)).toEqual(['install']);
    expect(listCatalogOffers([fetched(key, newer)], installed)[0]).toMatchObject({
      state: 'update',
      installedVersion: '1.0.0',
    });
    expect(listCatalogOffers([fetched(other, { ...newer, signingKey: other.jwk })], installed)).toEqual([]);
    const future = await catalogFor(key, new Uint8Array([1]), { sdk: '^9.0.0' });
    expect(listCatalogOffers([fetched(key, future)], [])[0]?.state).toBe('incompatible');
  });

  it('localizes entries by exact locale, then by language', async () => {
    const key = await createSigningKey();
    const [entry] = (
      await catalogFor(key, new Uint8Array([1]), { locales: { 'zh-CN': { name: '测试' }, en: { name: 'Test EN' } } })
    ).plugins;
    expect(localizeCatalogEntry(entry!, 'zh-CN').name).toBe('测试');
    expect(localizeCatalogEntry(entry!, 'en-GB').name).toBe('Test EN');
    expect(localizeCatalogEntry(entry!, 'ja').name).toBe('Test');
  });

  it('stops reading a catalog whose signing key changed', async () => {
    const key = await createSigningKey();
    const other = await createSigningKey();
    const body = JSON.stringify(await catalogFor(other, new Uint8Array([1])));
    const cache = new PluginCatalogCache({ fetch: respond(body), sha256 });
    await cache.refresh([{ url: indexUrl, keyId: key.keyId }], false);
    expect(cache.getSnapshot().get(indexUrl)).toMatchObject({ state: 'failed', keyChanged: true });
  });
});

describe('catalog links', () => {
  it('routes add-catalog links to plugin settings with the address', () => {
    const target = 'https://example.com/lunar/index.json';
    for (const path of [
      `lunar://add-catalog?url=${encodeURIComponent(target)}`,
      `lunar-dev://add-catalog/?url=${encodeURIComponent(target)}`,
      `/add-catalog?url=${encodeURIComponent(target)}`,
    ]) {
      expect(redirectCatalogLink({ path }), path).toBe(`/settings/plugins?add=${encodeURIComponent(target)}`);
    }
    expect(redirectCatalogLink({ path: 'lunar://add-catalog' })).toBe('/settings/plugins');
    expect(redirectCatalogLink({ path: '/library' })).toBeUndefined();
  });
});
