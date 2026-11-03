import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import {
  base64UrlEncode,
  jwkThumbprint,
  parseEd25519PublicJwk,
  serializePackageSignature,
  SIGNATURE_ALGORITHM,
  type Ed25519PublicJwk,
  type PackageSignature,
  type VerifyEd25519,
} from '@umbrae-labs/lunar-plugin-sdk/package-format';

/** A private key loaded from a PKCS#8 PEM file (RFC 5958 / RFC 8410). */
export interface SigningKey {
  readonly privateKey: KeyObject;
  readonly publicJwk: Ed25519PublicJwk;
  readonly keyId: string;
}

export class SigningError extends Error {}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Writes a new Ed25519 private key as PKCS#8 PEM; never overwrites an existing file. */
export async function generateSigningKey(file: string): Promise<SigningKey> {
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  try {
    await writeFile(file, pem, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new SigningError(`${file} already exists`);
    throw error;
  }
  return describeKey(privateKey);
}

export async function loadSigningKey(file: string): Promise<SigningKey> {
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(await readFile(file));
  } catch {
    throw new SigningError(`${file} is not a PKCS#8 private key`);
  }
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new SigningError(`${file} is not an Ed25519 key`);
  return describeKey(privateKey);
}

async function describeKey(privateKey: KeyObject): Promise<SigningKey> {
  const publicJwk = parseEd25519PublicJwk(createPublicKey(privateKey).export({ format: 'jwk' }));
  if (!publicJwk) throw new SigningError('The key has no Ed25519 public key');
  return { privateKey, publicJwk, keyId: await jwkThumbprint(publicJwk, sha256) };
}

/** Pure Ed25519 (RFC 8032) over the exact `integrity.json` bytes. */
export function signIntegrity(integrity: Uint8Array, key: SigningKey): PackageSignature {
  return {
    format: 1,
    algorithm: SIGNATURE_ALGORITHM,
    keyId: key.keyId,
    signature: base64UrlEncode(new Uint8Array(sign(null, integrity, key.privateKey))),
  };
}

export function encodeSignature(signature: PackageSignature): Uint8Array {
  return new TextEncoder().encode(serializePackageSignature(signature));
}

export const verifyEd25519: VerifyEd25519 = (signature, message, publicKey) =>
  verify(
    null,
    message,
    createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: base64UrlEncode(publicKey) }, format: 'jwk' }),
    signature,
  );
