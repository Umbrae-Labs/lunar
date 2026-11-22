import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parsePluginCatalog } from '../src/manifest';
import {
  base64UrlDecode,
  base64UrlEncode,
  jwkThumbprint,
  parseEd25519PublicJwk,
  parsePackageSignature,
  serializePackageSignature,
  verifyPackageSignature,
  type Ed25519PublicJwk,
  type VerifyEd25519,
} from '../src/package-format';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// RFC 8037 appendix A: the example key, its thumbprint and an Ed25519 signature made with it.
const RFC_KEY: Ed25519PublicJwk = { kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' };
const RFC_THUMBPRINT = 'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k';
const RFC_MESSAGE = new TextEncoder().encode('eyJhbGciOiJFZERTQSJ9.RXhhbXBsZSBvZiBFZDI1NTE5IHNpZ25pbmc');
const RFC_SIGNATURE = 'hgyY0il_MGCjP0JzlnLWG1PPOt7-09PGcvMg3AIbQR6dWbhijcNR4ki4iylGjg5BhVsPt9g7sVvpAr_MuM0KAg';

const nodeEd25519: VerifyEd25519 = (signature, message, publicKey) =>
  nodeVerify(
    null,
    message,
    createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: base64UrlEncode(publicKey) }, format: 'jwk' }),
    signature,
  );

describe('package signatures', () => {
  it('encodes base64url without padding and rejects non-canonical text', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0x00, 0x01]);
    expect(base64UrlEncode(bytes)).toBe(Buffer.from(bytes).toString('base64url'));
    expect(base64UrlDecode('-_8AAQ')).toEqual(bytes);
    for (const text of ['-_8AAQ==', '-_8AAR', 'a', 'ab+c']) expect(base64UrlDecode(text), text).toBeUndefined();
  });

  it('computes the RFC 7638 thumbprint of the RFC 8037 example key', async () => {
    expect(await jwkThumbprint(RFC_KEY, sha256)).toBe(RFC_THUMBPRINT);
  });

  it('accepts public Ed25519 JWKs only', () => {
    expect(parseEd25519PublicJwk({ ...RFC_KEY, alg: 'EdDSA', kid: 'k' })).toEqual(RFC_KEY);
    expect(parseEd25519PublicJwk({ ...RFC_KEY, d: 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A' })).toBeUndefined();
    expect(parseEd25519PublicJwk({ ...RFC_KEY, crv: 'X25519' })).toBeUndefined();
    expect(parseEd25519PublicJwk({ ...RFC_KEY, x: RFC_KEY.x.slice(1) })).toBeUndefined();
  });

  it('round-trips signature.json and checks it with a standard Ed25519 verifier', async () => {
    const text = serializePackageSignature({
      format: 1,
      algorithm: 'Ed25519',
      keyId: RFC_THUMBPRINT,
      signature: RFC_SIGNATURE,
    });
    const signature = parsePackageSignature(text);
    expect(signature).toBeDefined();
    expect(await verifyPackageSignature(RFC_MESSAGE, signature!, RFC_KEY, sha256, nodeEd25519)).toBeUndefined();

    const tampered = new Uint8Array(RFC_MESSAGE);
    tampered[0] ^= 1;
    expect(await verifyPackageSignature(tampered, signature!, RFC_KEY, sha256, nodeEd25519)).toBe(
      'the signature does not match the package contents',
    );
    const otherKey = { ...RFC_KEY, x: base64UrlEncode(new Uint8Array(32).fill(7)) };
    expect(await verifyPackageSignature(RFC_MESSAGE, signature!, otherKey, sha256, nodeEd25519)).toBe(
      'the signature names a different key',
    );
    expect(parsePackageSignature(text.replace('Ed25519', 'EdDSA'))).toBeUndefined();
  });
});

describe('plugin catalogs', () => {
  const entry = {
    id: 'org.example.hello',
    name: 'Hello',
    version: '1.0.0',
    sdk: '^0.1.0',
    package: 'packages/org.example.hello-1.0.0.lunar-plugin',
    sha256: 'a'.repeat(64),
    size: 120,
  };
  const catalog = { format: 1, name: 'Example', signingKey: RFC_KEY, plugins: [entry] };

  it('accepts a catalog and ignores fields it does not know', () => {
    const result = parsePluginCatalog({ ...catalog, future: true, plugins: [{ ...entry, future: 1 }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.catalog.plugins[0]).toEqual({ ...entry, permissions: [] });
  });

  it('rejects malformed keys, duplicate plugins and bad versions', () => {
    const result = parsePluginCatalog({
      ...catalog,
      signingKey: { ...RFC_KEY, x: 'short' },
      plugins: [entry, { ...entry, version: 'latest' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'signingKey.x: Invalid string: must match pattern /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/',
      ]),
    );
    expect(result.issues.some((issue) => issue.startsWith('plugins.1.version'))).toBe(true);
    expect(result.issues).toContain('plugins.1.id: duplicate plugin id');
  });
});
