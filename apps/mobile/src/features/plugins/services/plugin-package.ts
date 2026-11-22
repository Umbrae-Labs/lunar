import { strFromU8, unzipSync } from 'fflate';
import {
  isPackageIcon,
  MANIFEST_FILE,
  parsePluginManifest,
  satisfiesVersionRange,
  SDK_VERSION,
  type PluginManifest,
} from '@umbrae-labs/lunar-plugin-sdk/manifest';
import {
  ENTRY_FILE,
  findPathCollisions,
  INTEGRITY_FILE,
  LOCALES_DIRECTORY,
  PACKAGE_LIMITS,
  parseIntegrityManifest,
  parsePackageSignature,
  SIGNATURE_FILE,
  validatePackageIcon,
  validatePackagePath,
  verifyPackageIntegrity,
  type PackageSignature,
  type Sha256,
} from '@umbrae-labs/lunar-plugin-sdk/package-format';

import { LunarPluginError } from '../domain/plugin-error';
import type { PluginLocales } from '../domain/installed-plugin';

export interface PluginPackage {
  readonly manifest: PluginManifest;
  readonly locales: PluginLocales;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly packageSha256: string;
  readonly entrySha256: string;
  /** The exact `integrity.json` bytes, which a package signature covers. */
  readonly integrityBytes: Uint8Array;
  /** Present when the package carries a well-formed signature; it is not verified here. */
  readonly signature?: PackageSignature;
}

const LocaleFile = new RegExp(`^${LOCALES_DIRECTORY}/([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*)\\.json$`);

/** Validates archive structure, manifest, integrity and SDK compatibility without touching disk. */
export async function readPluginPackage(archive: Uint8Array, sha256: Sha256): Promise<PluginPackage> {
  if (archive.byteLength > PACKAGE_LIMITS.archiveBytes) {
    fail(`The package exceeds ${PACKAGE_LIMITS.archiveBytes} bytes`);
  }

  const names: string[] = [];
  let expanded = 0;
  let rejected: string | undefined;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archive, {
      // Reject by declared sizes before inflating anything.
      filter: (file) => {
        if (file.name.endsWith('/')) return false;
        names.push(file.name);
        expanded += file.originalSize;
        const problem = validatePackagePath(file.name);
        if (problem) rejected ??= `${file.name}: ${problem}`;
        else if (file.originalSize > PACKAGE_LIMITS.fileBytes) rejected ??= `${file.name} is too large`;
        else if (names.length > PACKAGE_LIMITS.entries) rejected ??= 'The package has too many files';
        else if (expanded > PACKAGE_LIMITS.expandedBytes) rejected ??= 'The package expands beyond its size limit';
        return rejected === undefined;
      },
    });
  } catch {
    fail('The file is not a valid plugin package');
  }
  if (rejected) fail(rejected);
  const collisions = findPathCollisions(names);
  if (collisions.length > 0 || new Set(names).size !== names.length) {
    fail(`The package contains conflicting paths: ${collisions.join(', ') || 'duplicates'}`);
  }

  const files = new Map(Object.entries(entries));
  const integrityBytes = files.get(INTEGRITY_FILE);
  const integrity = integrityBytes ? parseIntegrityManifest(readText(integrityBytes, INTEGRITY_FILE)) : undefined;
  if (!integrity) fail(`${INTEGRITY_FILE} is missing or invalid`);
  const problems = await verifyPackageIntegrity(files, integrity, sha256);
  if (problems.length > 0) fail(`Integrity check failed: ${problems.join('; ')}`);

  const signatureBytes = files.get(SIGNATURE_FILE);
  const signature = signatureBytes ? parsePackageSignature(readText(signatureBytes, SIGNATURE_FILE)) : undefined;
  if (signatureBytes && !signature) fail(`${SIGNATURE_FILE} is invalid`);

  const manifestBytes = files.get(MANIFEST_FILE);
  if (!manifestBytes) fail(`${MANIFEST_FILE} is missing`);
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(readText(manifestBytes, MANIFEST_FILE));
  } catch {
    fail(`${MANIFEST_FILE} is not valid JSON`);
  }
  const parsed = parsePluginManifest(rawManifest);
  if (!parsed.ok) fail(`${MANIFEST_FILE} is invalid: ${parsed.issues.join('; ')}`);
  const manifest = parsed.manifest;
  if (manifest.trust !== 'full') {
    throw new LunarPluginError('CAPABILITY_UNAVAILABLE', 'Sandboxed plugins are not supported by this version');
  }
  if (manifest.publisherKeyId && signature?.keyId !== manifest.publisherKeyId) {
    fail(`The package must be signed with the publisher key ${manifest.publisherKeyId}`);
  }
  if (!satisfiesVersionRange(SDK_VERSION, manifest.sdk)) {
    throw new LunarPluginError(
      'INCOMPATIBLE_SDK',
      `The plugin needs SDK ${manifest.sdk}; Lunar provides ${SDK_VERSION}`,
    );
  }

  if (isPackageIcon(manifest.icon)) {
    const problem = validatePackageIcon(files.get(manifest.icon));
    if (problem) fail(`${manifest.icon}: ${problem}`);
  }

  const entry = files.get(ENTRY_FILE);
  if (!entry) fail(`${ENTRY_FILE} is missing`);
  if (entry.byteLength > PACKAGE_LIMITS.entryFileBytes) fail(`${ENTRY_FILE} is too large`);
  readText(entry, ENTRY_FILE);

  const locales: Record<string, Record<string, string>> = {};
  for (const [path, bytes] of files) {
    const locale = LocaleFile.exec(path)?.[1];
    if (!locale) continue;
    let value: unknown;
    try {
      value = JSON.parse(readText(bytes, path));
    } catch {
      fail(`${path} is not valid JSON`);
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      Object.values(value).some((item) => typeof item !== 'string')
    ) {
      fail(`${path} must contain string messages`);
    }
    locales[locale] = value as Record<string, string>;
  }

  return {
    manifest,
    locales,
    files,
    packageSha256: (await sha256(archive)).toLowerCase(),
    entrySha256: integrity.files.find((file) => file.path === ENTRY_FILE)!.sha256,
    integrityBytes: integrityBytes!,
    signature,
  };
}

// fflate's decoder is pure JavaScript, so it does not depend on the engine's TextDecoder support.
function readText(bytes: Uint8Array, path: string): string {
  try {
    return strFromU8(bytes);
  } catch {
    fail(`${path} is not UTF-8 text`);
  }
}

function fail(message: string): never {
  throw new LunarPluginError('INTEGRITY_FAILED', message);
}
