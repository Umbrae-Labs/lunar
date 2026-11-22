import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import {
  CATALOG_FILE,
  CATALOG_FORMAT,
  isPackageIcon,
  localizeManifestText,
  MANIFEST_FILE,
  parsePluginCatalog,
  parsePluginManifest,
  type PluginCatalog,
} from '@umbrae-labs/lunar-plugin-sdk/manifest';
import {
  INTEGRITY_FILE,
  LOCALES_DIRECTORY,
  parseIntegrityManifest,
  parsePackageSignature,
  SIGNATURE_FILE,
  verifyPackageIntegrity,
  verifyPackageSignature,
} from '@umbrae-labs/lunar-plugin-sdk/package-format';
import { sha256 } from './pack.ts';
import { verifyEd25519, type SigningKey } from './sign.ts';

export interface CatalogOptions {
  readonly outDir: string;
  readonly name: string;
  readonly badge?: string;
  readonly website?: string;
  readonly key: SigningKey;
  /** Packed `.lunar-plugin` files; each must be signed with `key`. */
  readonly packages: readonly string[];
}

export class CatalogError extends Error {}

type CatalogPlugin = PluginCatalog['plugins'][number];

const LocaleFile = new RegExp(`^${LOCALES_DIRECTORY}/([a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*)\\.json$`);

/**
 * Writes `index.json` with the packages under `packages/` and their icons under `icons/`.
 * The output directory can be served as is from any static HTTPS host.
 */
export async function buildCatalog(options: CatalogOptions): Promise<{ file: string; catalog: PluginCatalog }> {
  const plugins: CatalogPlugin[] = [];
  await mkdir(path.join(options.outDir, 'packages'), { recursive: true });
  for (const file of options.packages) {
    const plugin = await describePackage(file, options);
    if (plugins.some((item) => item.id === plugin.id)) {
      throw new CatalogError(`${file}: ${plugin.id} is listed more than once`);
    }
    plugins.push(plugin);
  }
  plugins.sort((left, right) => (left.id < right.id ? -1 : 1));

  const parsed = parsePluginCatalog({
    format: CATALOG_FORMAT,
    name: options.name,
    badge: options.badge,
    website: options.website,
    signingKey: options.key.publicJwk,
    plugins,
  });
  if (!parsed.ok)
    throw new CatalogError(`The catalog is invalid\n${parsed.issues.map((item) => `  - ${item}`).join('\n')}`);
  const target = path.join(options.outDir, CATALOG_FILE);
  await writeFile(target, `${JSON.stringify(parsed.catalog, null, 2)}\n`);
  return { file: target, catalog: parsed.catalog };
}

async function describePackage(file: string, options: CatalogOptions): Promise<CatalogPlugin> {
  const archive = new Uint8Array(await readFile(file));
  let files: Map<string, Uint8Array>;
  try {
    files = new Map(Object.entries(unzipSync(archive)));
  } catch {
    throw new CatalogError(`${file} is not a plugin package`);
  }
  const fail = (message: string): never => {
    throw new CatalogError(`${file}: ${message}`);
  };

  const integrityBytes = files.get(INTEGRITY_FILE) ?? fail(`${INTEGRITY_FILE} is missing`);
  const integrity = parseIntegrityManifest(strFromU8(integrityBytes)) ?? fail(`${INTEGRITY_FILE} is invalid`);
  const problems = await verifyPackageIntegrity(files, integrity, sha256);
  if (problems.length > 0) fail(`integrity check failed: ${problems.join('; ')}`);

  const signatureBytes = files.get(SIGNATURE_FILE) ?? fail('the package is not signed; pack it with --key');
  const signature = parsePackageSignature(strFromU8(signatureBytes)) ?? fail(`${SIGNATURE_FILE} is invalid`);
  const signatureProblem = await verifyPackageSignature(
    integrityBytes,
    signature,
    options.key.publicJwk,
    sha256,
    verifyEd25519,
  );
  if (signatureProblem) fail(`not signed by the catalog key: ${signatureProblem}`);

  const manifestBytes = files.get(MANIFEST_FILE) ?? fail(`${MANIFEST_FILE} is missing`);
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(manifestBytes));
  } catch {
    fail(`${MANIFEST_FILE} is not valid JSON`);
  }
  const parsed = parsePluginManifest(raw);
  const manifest = parsed.ok ? parsed.manifest : fail(`${MANIFEST_FILE} is invalid: ${parsed.issues.join('; ')}`);

  const locales = new Map<string, Record<string, string>>();
  for (const [filePath, bytes] of files) {
    const locale = LocaleFile.exec(filePath)?.[1];
    if (locale) locales.set(locale, JSON.parse(strFromU8(bytes)) as Record<string, string>);
  }
  const defaultMessages = locales.get(manifest.defaultLocale ?? '') ?? locales.values().next().value;
  const text = (value: string | undefined, messages: Record<string, string> | undefined) =>
    value === undefined ? undefined : localizeManifestText(value, messages);

  const packageName = path.basename(file);
  await copyFile(file, path.join(options.outDir, 'packages', packageName));
  let icon: string | undefined;
  if (isPackageIcon(manifest.icon)) {
    icon = `icons/${manifest.id}.png`;
    await mkdir(path.join(options.outDir, 'icons'), { recursive: true });
    await writeFile(path.join(options.outDir, icon), files.get(manifest.icon) ?? fail(`${manifest.icon} is missing`));
  }

  return {
    id: manifest.id,
    name: text(manifest.name, defaultMessages)!,
    version: manifest.version,
    sdk: manifest.sdk,
    description: text(manifest.description, defaultMessages),
    author: manifest.author,
    package: `packages/${encodeURIComponent(packageName)}`,
    icon,
    sha256: sha256(archive),
    size: archive.byteLength,
    permissions: manifest.permissions.map((permission) => permission.name),
    locales:
      locales.size > 0
        ? Object.fromEntries(
            [...locales].map(([locale, messages]) => [
              locale,
              { name: text(manifest.name, messages), description: text(manifest.description, messages) },
            ]),
          )
        : undefined,
  };
}
