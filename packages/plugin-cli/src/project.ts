import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isPackageIcon,
  LEGACY_NETWORK_PERMISSION,
  MANIFEST_FILE,
  parsePluginManifest,
  type PluginManifest,
} from '@umbrae-labs/lunar-plugin-sdk/manifest';
import { LOCALES_DIRECTORY, validatePackageIcon } from '@umbrae-labs/lunar-plugin-sdk/package-format';

export interface PluginProject {
  readonly root: string;
  readonly manifest: PluginManifest;
  readonly manifestText: string;
  readonly entry: string;
  readonly outDir: string;
  readonly locales: ReadonlyMap<string, Readonly<Record<string, string>>>;
  /** Package-relative paths of static files copied into the package. */
  readonly staticFiles: readonly string[];
}

export class ProjectError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(issues.length > 0 ? `${message}\n${issues.map((issue) => `  - ${issue}`).join('\n')}` : message);
    this.name = 'ProjectError';
    this.issues = issues;
  }
}

const ENTRY_CANDIDATES = ['src/index.tsx', 'src/index.ts', 'src/index.jsx', 'src/index.js'];
const LOCALE_FILE = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*\.json$/;

export async function loadProject(directory: string): Promise<PluginProject> {
  const root = path.resolve(directory);
  const manifestPath = path.join(root, MANIFEST_FILE);
  if (!existsSync(manifestPath)) throw new ProjectError(`${MANIFEST_FILE} was not found in ${root}`);
  const manifestText = await readFile(manifestPath, 'utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(manifestText);
  } catch (error) {
    throw new ProjectError(`${MANIFEST_FILE} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = parsePluginManifest(raw);
  if (!parsed.ok) throw new ProjectError(`${MANIFEST_FILE} is invalid`, parsed.issues);
  const legacy = parsed.manifest.permissions.flatMap((item, index) =>
    LEGACY_NETWORK_PERMISSION.test(item.name)
      ? [`permissions.${index}.name: per-origin "${item.name}" was replaced by a single "network" permission`]
      : [],
  );
  if (legacy.length > 0) throw new ProjectError(`${MANIFEST_FILE} is invalid`, legacy);
  if (parsed.manifest.trust !== 'full') {
    throw new ProjectError('Only "trust": "full" plugins can be built with SDK 0.1');
  }

  const icon = parsed.manifest.icon;
  if (isPackageIcon(icon)) {
    const iconPath = path.join(root, icon);
    const problem = validatePackageIcon(existsSync(iconPath) ? await readFile(iconPath) : undefined);
    if (problem) throw new ProjectError(`${MANIFEST_FILE} is invalid`, [`icon ${icon}: ${problem}`]);
  }

  const entry = await resolveEntry(root);
  const locales = await readLocales(root, parsed.manifest);
  const staticFiles = [
    ...(await listFiles(root, 'assets')),
    ...['LICENSE', 'LICENSE.md', 'README.md'].filter((file) => existsSync(path.join(root, file))),
  ];
  return {
    root,
    manifest: parsed.manifest,
    manifestText,
    entry,
    outDir: path.join(root, 'dist'),
    locales,
    staticFiles,
  };
}

async function resolveEntry(root: string): Promise<string> {
  const packagePath = path.join(root, 'package.json');
  if (existsSync(packagePath)) {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { lunar?: { entry?: unknown } };
    const configured = packageJson.lunar?.entry;
    if (typeof configured === 'string') {
      const resolved = path.resolve(root, configured);
      if (!existsSync(resolved)) throw new ProjectError(`The configured entry ${configured} does not exist`);
      return resolved;
    }
  }
  const found = ENTRY_CANDIDATES.map((candidate) => path.join(root, candidate)).find((candidate) =>
    existsSync(candidate),
  );
  if (!found) throw new ProjectError(`No entry found; expected one of ${ENTRY_CANDIDATES.join(', ')}`);
  return found;
}

async function readLocales(
  root: string,
  manifest: PluginManifest,
): Promise<ReadonlyMap<string, Readonly<Record<string, string>>>> {
  const directory = path.join(root, LOCALES_DIRECTORY);
  const locales = new Map<string, Readonly<Record<string, string>>>();
  if (!existsSync(directory)) return locales;
  const issues: string[] = [];
  for (const file of (await readdir(directory)).sort()) {
    if (!file.endsWith('.json')) continue;
    if (!LOCALE_FILE.test(file)) {
      issues.push(`${LOCALES_DIRECTORY}/${file}: file name must be a language tag such as zh-CN.json`);
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
    } catch (error) {
      issues.push(`${LOCALES_DIRECTORY}/${file}: ${(error as Error).message}`);
      continue;
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      Object.values(value).some((entry) => typeof entry !== 'string')
    ) {
      issues.push(`${LOCALES_DIRECTORY}/${file}: must be an object of string messages`);
      continue;
    }
    locales.set(file.slice(0, -'.json'.length), value as Record<string, string>);
  }
  for (const key of manifestTextKeys(manifest)) {
    for (const [locale, messages] of locales) {
      if (messages[key] === undefined) issues.push(`${LOCALES_DIRECTORY}/${locale}.json: missing "${key}"`);
    }
    if (locales.size === 0) issues.push(`"%${key}%" is used in ${MANIFEST_FILE} but there is no locales directory`);
  }
  if (issues.length > 0) throw new ProjectError('Locale files are invalid', issues);
  return locales;
}

/** Keys referenced as `%key%` anywhere in the manifest's display text. */
export function manifestTextKeys(manifest: PluginManifest): readonly string[] {
  const keys = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      const match = /^%([^%]+)%$/.exec(value);
      if (match) keys.add(match[1]);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(visit);
    }
  };
  visit({ name: manifest.name, description: manifest.description, contributes: manifest.contributes });
  return [...keys];
}

async function listFiles(root: string, directory: string): Promise<string[]> {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  const entries = await readdir(absolute, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}
