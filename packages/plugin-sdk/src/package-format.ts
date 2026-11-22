// Shared by the Lunar host and the plugin CLI. Keep this module free of
// runtime imports: Node runs the CLI from TypeScript source directly.

export const PACKAGE_EXTENSION = '.lunar-plugin';
export const INTEGRITY_FILE = 'integrity.json';
export const SIGNATURE_FILE = 'signature.json';
export const ENTRY_FILE = 'main.js';
export const LOCALES_DIRECTORY = 'locales';

export const PACKAGE_LIMITS = {
  archiveBytes: 10 * 1024 * 1024,
  expandedBytes: 30 * 1024 * 1024,
  entryFileBytes: 2 * 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
  entries: 500,
  depth: 8,
  iconBytes: 512 * 1024,
} as const;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Returns why a packaged icon is unacceptable, or `undefined` for a usable PNG. */
export function validatePackageIcon(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes) return 'file is missing';
  if (bytes.byteLength > PACKAGE_LIMITS.iconBytes) return `file exceeds ${PACKAGE_LIMITS.iconBytes} bytes`;
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return 'file is not a PNG image';
  return undefined;
}

export interface IntegrityEntry {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface IntegrityManifest {
  readonly format: 1;
  readonly algorithm: 'sha256';
  readonly files: readonly IntegrityEntry[];
}

export type Sha256 = (bytes: Uint8Array) => string | Promise<string>;

/** Returns why a package path is unacceptable, or `undefined` for a safe relative path. */
export function validatePackagePath(path: string): string | undefined {
  if (path.length === 0 || path.length > 200) return 'path length is out of range';
  if (path.includes('\\')) return 'path uses a backslash';
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return 'path is absolute';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return 'path contains a control character';
  const segments = path.split('/');
  if (segments.length > PACKAGE_LIMITS.depth) return 'path is nested too deeply';
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return 'path contains an empty or relative segment';
  }
  return undefined;
}

/** Paths that collide on case-insensitive or Unicode-normalising file systems. */
export function findPathCollisions(paths: readonly string[]): readonly string[] {
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const path of paths) {
    const folded = path.normalize('NFC').toLowerCase();
    const previous = seen.get(folded);
    if (previous !== undefined) collisions.push(previous === path ? path : `${previous} / ${path}`);
    else seen.set(folded, path);
  }
  return collisions;
}

export function isIntegrityExempt(path: string): boolean {
  return path === INTEGRITY_FILE || path === SIGNATURE_FILE;
}

export async function createIntegrityManifest(
  files: readonly { readonly path: string; readonly bytes: Uint8Array }[],
  sha256: Sha256,
): Promise<IntegrityManifest> {
  const entries: IntegrityEntry[] = [];
  for (const file of files) {
    if (isIntegrityExempt(file.path)) continue;
    entries.push({ path: file.path, size: file.bytes.byteLength, sha256: (await sha256(file.bytes)).toLowerCase() });
  }
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { format: 1, algorithm: 'sha256', files: entries };
}

/** Canonical bytes: sorted entries, fixed key order, two-space indentation and a final newline. */
export function serializeIntegrityManifest(manifest: IntegrityManifest): string {
  const files = [...manifest.files]
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((entry) => ({ path: entry.path, size: entry.size, sha256: entry.sha256 }));
  return `${JSON.stringify({ format: manifest.format, algorithm: manifest.algorithm, files }, null, 2)}\n`;
}

export function parseIntegrityManifest(text: string): IntegrityManifest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.format !== 1 || value.algorithm !== 'sha256' || !Array.isArray(value.files)) {
    return undefined;
  }
  const files: IntegrityEntry[] = [];
  for (const entry of value.files) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== 'string' ||
      typeof entry.size !== 'number' ||
      !Number.isInteger(entry.size) ||
      entry.size < 0 ||
      typeof entry.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.sha256)
    ) {
      return undefined;
    }
    files.push({ path: entry.path, size: entry.size, sha256: entry.sha256 });
  }
  return { format: 1, algorithm: 'sha256', files };
}

/** Every file except the integrity and signature files must be listed with a matching size and digest. */
export async function verifyPackageIntegrity(
  files: ReadonlyMap<string, Uint8Array>,
  manifest: IntegrityManifest,
  sha256: Sha256,
): Promise<readonly string[]> {
  const problems: string[] = [];
  const listed = new Map(manifest.files.map((entry) => [entry.path, entry]));
  if (listed.size !== manifest.files.length) problems.push('integrity manifest lists a file twice');
  for (const [path, bytes] of files) {
    if (isIntegrityExempt(path)) continue;
    const entry = listed.get(path);
    if (!entry) {
      problems.push(`${path} is not listed in ${INTEGRITY_FILE}`);
      continue;
    }
    listed.delete(path);
    if (entry.size !== bytes.byteLength) {
      problems.push(`${path} size does not match`);
      continue;
    }
    if ((await sha256(bytes)).toLowerCase() !== entry.sha256) problems.push(`${path} digest does not match`);
  }
  for (const path of listed.keys()) problems.push(`${path} is listed but missing`);
  return problems;
}

// Signatures
//
// A signed package carries `signature.json`: an Ed25519 signature (RFC 8032) over the exact bytes of
// `integrity.json`, which in turn lists the digest of every other file. Public keys are exchanged as
// JSON Web Keys (RFC 8037) and identified by their JWK thumbprint (RFC 7638).

export const SIGNATURE_ALGORITHM = 'Ed25519';

/** An Ed25519 public key as a JSON Web Key (RFC 8037). */
export interface Ed25519PublicJwk {
  readonly kty: 'OKP';
  readonly crv: 'Ed25519';
  /** The RFC 8032 public key encoding, base64url without padding. */
  readonly x: string;
}

export interface PackageSignature {
  readonly format: 1;
  readonly algorithm: typeof SIGNATURE_ALGORITHM;
  /** JWK thumbprint (RFC 7638, SHA-256) of the signing key. */
  readonly keyId: string;
  /** The 64-byte RFC 8032 signature, base64url without padding. */
  readonly signature: string;
}

/** Verifies a pure Ed25519 (RFC 8032) signature over a message with a 32-byte public key. */
export type VerifyEd25519 = (
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
) => boolean | Promise<boolean>;

const ED25519_KEY_BYTES = 32;
const ED25519_SIGNATURE_BYTES = 64;

/** Returns the key when the value is an Ed25519 public JWK; other JWK members are ignored. */
export function parseEd25519PublicJwk(value: unknown): Ed25519PublicJwk | undefined {
  if (!isRecord(value) || value.kty !== 'OKP' || value.crv !== 'Ed25519' || typeof value.x !== 'string') {
    return undefined;
  }
  if ('d' in value) return undefined;
  return base64UrlDecode(value.x)?.byteLength === ED25519_KEY_BYTES
    ? { kty: 'OKP', crv: 'Ed25519', x: value.x }
    : undefined;
}

/** RFC 7638 thumbprint: SHA-256 over the required members in lexicographic order, base64url encoded. */
export async function jwkThumbprint(jwk: Ed25519PublicJwk, sha256: Sha256): Promise<string> {
  const canonical = `{"crv":"${jwk.crv}","kty":"${jwk.kty}","x":"${jwk.x}"}`;
  return base64UrlEncode(hexToBytes(await sha256(new TextEncoder().encode(canonical))));
}

export function serializePackageSignature(signature: PackageSignature): string {
  const { format, algorithm, keyId, signature: value } = signature;
  return `${JSON.stringify({ format, algorithm, keyId, signature: value }, null, 2)}
`;
}

export function parsePackageSignature(text: string): PackageSignature | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    !isRecord(value) ||
    value.format !== 1 ||
    value.algorithm !== SIGNATURE_ALGORITHM ||
    typeof value.keyId !== 'string' ||
    base64UrlDecode(value.keyId)?.byteLength !== 32 ||
    typeof value.signature !== 'string' ||
    base64UrlDecode(value.signature)?.byteLength !== ED25519_SIGNATURE_BYTES
  ) {
    return undefined;
  }
  return { format: 1, algorithm: SIGNATURE_ALGORITHM, keyId: value.keyId, signature: value.signature };
}

/** Checks a package signature against a public key; returns why it is not acceptable. */
export async function verifyPackageSignature(
  integrityBytes: Uint8Array,
  signature: PackageSignature,
  key: Ed25519PublicJwk,
  sha256: Sha256,
  verify: VerifyEd25519,
): Promise<string | undefined> {
  if ((await jwkThumbprint(key, sha256)) !== signature.keyId) return 'the signature names a different key';
  const publicKey = base64UrlDecode(key.x);
  const value = base64UrlDecode(signature.signature);
  if (!publicKey || !value) return 'the signature or key is malformed';
  let valid = false;
  try {
    valid = await verify(value, integrityBytes, publicKey);
  } catch {
    valid = false;
  }
  return valid ? undefined : 'the signature does not match the package contents';
}

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Base64url without padding (RFC 4648 section 5), as JOSE uses it. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index]! << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    const characters = Math.min(4, Math.ceil(((bytes.length - index) * 8) / 6));
    for (let position = 0; position < characters; position += 1) {
      output += BASE64URL[(chunk >> (18 - position * 6)) & 63];
    }
  }
  return output;
}

/** Decodes canonical unpadded base64url; returns `undefined` for any other text. */
export function base64UrlDecode(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined;
  const bytes = new Uint8Array(Math.floor((text.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const character of text) {
    buffer = (buffer << 6) | BASE64URL.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (buffer >> bits) & 0xff;
    }
  }
  // Leftover bits must be zero, so every byte string has exactly one encoding.
  if ((buffer & ((1 << bits) - 1)) !== 0) return undefined;
  return bytes;
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  let output = '';
  for (const byte of bytes) output += byte.toString(16).padStart(2, '0');
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
