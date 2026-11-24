import { describe, expect, it } from 'vitest';

import type { InstalledPlugin } from '../../src/features/plugins/domain/installed-plugin';
import type { PluginRecordRepository } from '../../src/features/plugins/repositories/plugin-repository';
import { PluginInstaller, type TrustedSigningKey } from '../../src/features/plugins/services/plugin-installer';
import { readPluginPackage } from '../../src/features/plugins/services/plugin-package';
import { verifyEd25519 } from '../../src/features/plugins/services/plugin-signature';
import {
  createSigningKey,
  manifest,
  memoryStorage,
  packArchive,
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

  it('verifies an explicit GitHub download, pins the signer and keeps unrelated files untrusted', async () => {
    const first = await createSigningKey();
    const other = await createSigningKey();
    const { installer } = setup([]);
    const origin = { githubRepository: 'example/plugin' };
    const archive = await packArchive(files(), { signWith: first });
    expect((await installer.inspect(archive)).trust.kind).toBe('unknownKey');
    await installer.install(await installer.inspect(archive, origin));
    const update = await packArchive(files('1.1.0'), { signWith: first });
    expect((await installer.inspect(update, origin)).trust).toMatchObject({ kind: 'verified', keyId: first.keyId });
    await expect(installer.inspect(await packArchive(files('1.2.0'), { signWith: other }), origin)).rejects.toThrow(
      'another publisher',
    );
    await expect(
      installer.inspect(await packArchive(files('1.3.0'), { signWith: other, keyId: first.keyId }), origin),
    ).rejects.toThrow('Signature check failed');
  });

  it('binds a reviewed release to its plugin ID, version and publisher', async () => {
    const author = await createSigningKey();
    const { installer } = setup([]);
    const archive = await packArchive(files(), { signWith: author });
    const market = { id, version: '1.0.0', publisher: { key: author.jwk, keyId: author.keyId, catalogName: 'Lunar' } };
    expect((await installer.inspect(archive, { market })).trust.kind).toBe('verified');
    await expect(installer.inspect(archive, { market: { ...market, id: 'org.example.other' } })).rejects.toThrow(
      'reviewed',
    );
    await expect(installer.inspect(archive, { market: { ...market, version: '2.0.0' } })).rejects.toThrow('reviewed');
    await expect(installer.inspect(await packArchive(files()), { market })).rejects.toThrow('reviewed');
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
