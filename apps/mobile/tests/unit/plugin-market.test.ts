import { sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { downloadGithubPlugin } from '../../src/features/plugins/services/github-release';
import { fetchMarket, fetchMarketConfig } from '../../src/features/plugins/services/plugin-market';
import { listCatalogOffers, localizeCatalogEntry } from '../../src/features/plugins/services/plugin-catalog';
import { createSigningKey, plugin, sha256 } from './plugin-test-support';

const repo = 'https://github.com/example/reader';
const url = repo + '/releases/download/v1.0.0/sample.lunar-plugin';
const bytes = new Uint8Array([1, 2, 3]);
const api = 'https://api.github.com/repos/example/reader/releases/';
const mirror = 'https://mirror.example';
const asset = { browser_download_url: url, size: bytes.length, digest: 'sha256:' + sha256(bytes) };

describe('GitHub plugin downloads', () => {
  it.each([
    [repo, 'latest'],
    [repo + '/releases/tag/v1.0.0', 'tags/v1.0.0'],
    [repo + '/releases/latest', 'latest'],
  ])('resolves %s and retries the original asset after a bad mirror response', async (input, release) => {
    const request = vi.fn(async (address: string) =>
      address === api + release
        ? Response.json({ assets: [asset] })
        : new Response(address === url ? bytes : new Uint8Array([3, 2, 1])),
    );
    expect(await downloadGithubPlugin(input!, request, sha256, mirror)).toEqual({
      archive: bytes,
      githubRepository: 'example/reader',
    });
    expect(request.mock.calls.map(([address]) => address)).toEqual([api + release, mirror + '/' + url, url]);
  });
  it('accepts an exact asset when the API is unavailable, without trusting a mirror', async () => {
    const request = vi.fn(async (address: string) =>
      address === url ? new Response(bytes) : new Response('', { status: 403 }),
    );
    expect((await downloadGithubPlugin(url, request, sha256, mirror)).archive).toEqual(bytes);
    expect(request.mock.calls.map(([address]) => address)).toEqual([api + 'tags/v1.0.0', url]);
  });
  it('asks for a specific asset for ambiguous releases and refuses unrelated URLs', async () => {
    const request = vi.fn(async () => Response.json({ assets: [asset, asset] }));
    await expect(downloadGithubPlugin(repo, request, sha256)).rejects.toThrow('multiple');
    await expect(downloadGithubPlugin('https://example.org/file.lunar-plugin', request, sha256)).rejects.toThrow(
      'GitHub',
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
});

it('authenticates the catalog independently of the plugin publisher and rejects altered metadata', async () => {
  const market = await createSigningKey();
  const author = await createSigningKey();
  const entry = {
    id: 'org.example.test',
    name: 'Test',
    version: '1.1.0',
    sdk: '^0.1.0',
    package: url,
    size: bytes.length,
    sha256: sha256(bytes),
    publisherKey: author.jwk,
    locales: { en: { name: 'Reader' } },
  };
  const payload = JSON.stringify({ format: 2, plugins: [entry] });
  const signature = {
    format: 1,
    algorithm: 'Ed25519',
    keyId: market.keyId,
    signature: sign(null, Buffer.from(payload), market.privateKey).toString('base64url'),
  };
  const read = (body: string, key = market.jwk.x) =>
    fetchMarket(
      { format: 1, indexUrl: 'https://market.example/index.json', publicKey: { ...market.jwk, x: key } },
      async () => Response.json({ payload: body, signature }),
      sha256,
    );
  const entries = await read(payload);
  expect(entries[0]?.publisher.keyId).toBe(author.keyId);
  const installed = plugin('', { version: '1.0.0', signerKeyId: author.keyId });
  expect(listCatalogOffers(entries, [installed])[0]?.state).toBe('update');
  expect(listCatalogOffers(entries, [{ ...installed, signerKeyId: market.keyId }])).toEqual([]);
  expect(localizeCatalogEntry(entries[0]!.entry, 'en-US').name).toBe('Reader');
  await expect(read(payload.replace('Reader', 'Changed'))).rejects.toThrow('signature');
  await expect(read(payload, author.jwk.x)).rejects.toThrow('signature');
});

it('loads the current mirror, index location and key from the same config URL on subsequent requests', async () => {
  const endpoint = 'https://example.org/plugins/config.json';
  const first = await createSigningKey();
  const next = await createSigningKey();
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ format: 1, indexUrl: 'index.json', publicKey: first.jwk, githubMirror: mirror }),
    )
    .mockResolvedValueOnce(
      Response.json({ format: 1, indexUrl: 'https://new.example/market.json', publicKey: next.jwk }),
    );
  expect(await fetchMarketConfig(endpoint, request)).toMatchObject({
    indexUrl: 'https://example.org/plugins/index.json',
    publicKey: first.jwk,
    githubMirror: mirror,
  });
  expect(await fetchMarketConfig(endpoint, request)).toEqual({
    format: 1,
    indexUrl: 'https://new.example/market.json',
    publicKey: next.jwk,
  });
  expect(request.mock.calls.map(([url]) => url)).toEqual([endpoint, endpoint]);
});

it('rejects invalid config before consulting an index or mirror', async () => {
  const key = await createSigningKey();
  const config = { format: 1, indexUrl: 'index.json', publicKey: key.jwk };
  for (const invalid of [
    { format: 2 },
    { publicKey: { ...key.jwk, d: 'private' } },
    { githubMirror: 'http://mirror.example' },
    { indexUrl: '//external.example/index.json' },
  ]) {
    await expect(
      fetchMarketConfig('https://market.example/config.json', async () => Response.json({ ...config, ...invalid })),
    ).rejects.toThrow();
  }
  const request = vi.fn();
  await expect(fetchMarketConfig('http://market.example/config.json', request)).rejects.toThrow('URL');
  expect(request).not.toHaveBeenCalled();
});
