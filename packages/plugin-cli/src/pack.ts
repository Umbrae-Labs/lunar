import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, type Zippable } from 'fflate';
import { MANIFEST_FILE } from '@umbrae-labs/lunar-plugin-sdk/manifest';
import {
  createIntegrityManifest,
  ENTRY_FILE,
  INTEGRITY_FILE,
  LOCALES_DIRECTORY,
  PACKAGE_EXTENSION,
  PACKAGE_LIMITS,
  serializeIntegrityManifest,
  SIGNATURE_FILE,
  validatePackagePath,
} from '@umbrae-labs/lunar-plugin-sdk/package-format';
import { buildPlugin } from './build.ts';
import type { PluginProject } from './project.ts';
import { encodeSignature, signIntegrity, SigningError, type SigningKey } from './sign.ts';

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// A fixed timestamp keeps identical inputs byte-identical across machines.
const PACKAGE_MTIME = new Date('2020-01-01T00:00:00Z');

export interface PackResult {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  /** Key id of the signature, for signed packages. */
  readonly keyId?: string;
  readonly warnings: readonly string[];
}

export async function collectPackageFiles(project: PluginProject, entry: Uint8Array): Promise<Map<string, Uint8Array>> {
  const encoder = new TextEncoder();
  const files = new Map<string, Uint8Array>();
  files.set(MANIFEST_FILE, encoder.encode(project.manifestText));
  files.set(ENTRY_FILE, entry);
  for (const [locale, messages] of project.locales) {
    files.set(`${LOCALES_DIRECTORY}/${locale}.json`, encoder.encode(`${JSON.stringify(messages, null, 2)}\n`));
  }
  for (const file of project.staticFiles) {
    files.set(file, new Uint8Array(await readFile(path.join(project.root, file))));
  }
  const integrity = await createIntegrityManifest(
    [...files].map(([filePath, bytes]) => ({ path: filePath, bytes })),
    sha256,
  );
  files.set(INTEGRITY_FILE, encoder.encode(serializeIntegrityManifest(integrity)));
  return files;
}

export function checkPackageLimits(files: ReadonlyMap<string, Uint8Array>): readonly string[] {
  const problems: string[] = [];
  if (files.size > PACKAGE_LIMITS.entries) {
    problems.push(`package has ${files.size} files; the limit is ${PACKAGE_LIMITS.entries}`);
  }
  let total = 0;
  for (const [file, bytes] of files) {
    const pathProblem = validatePackagePath(file);
    if (pathProblem) problems.push(`${file}: ${pathProblem}`);
    if (bytes.byteLength > PACKAGE_LIMITS.fileBytes) problems.push(`${file} exceeds ${PACKAGE_LIMITS.fileBytes} bytes`);
    total += bytes.byteLength;
  }
  if (total > PACKAGE_LIMITS.expandedBytes) {
    problems.push(`package expands to ${total} bytes; the limit is ${PACKAGE_LIMITS.expandedBytes}`);
  }
  return problems;
}

export async function packPlugin(project: PluginProject, key?: SigningKey): Promise<PackResult> {
  const publisherKeyId = project.manifest.publisherKeyId;
  if (publisherKeyId && !key) throw new SigningError('manifest.json declares publisherKeyId; pass --key to sign');
  if (publisherKeyId && key && key.keyId !== publisherKeyId) {
    throw new SigningError(`The key ${key.keyId} does not match publisherKeyId ${publisherKeyId}`);
  }
  const build = await buildPlugin(project);
  const files = await collectPackageFiles(project, build.code);
  if (key) files.set(SIGNATURE_FILE, encodeSignature(signIntegrity(files.get(INTEGRITY_FILE)!, key)));
  const problems = checkPackageLimits(files);
  if (problems.length > 0) {
    throw new Error(`Package limits exceeded\n${problems.map((item) => `  - ${item}`).join('\n')}`);
  }

  const zippable: Zippable = {};
  for (const [file, bytes] of [...files].sort(([left], [right]) => (left < right ? -1 : 1))) {
    zippable[file] = [bytes, { mtime: PACKAGE_MTIME, level: 9 }];
  }
  const archive = zipSync(zippable);
  if (archive.byteLength > PACKAGE_LIMITS.archiveBytes) {
    throw new Error(`Package is ${archive.byteLength} bytes; the limit is ${PACKAGE_LIMITS.archiveBytes}`);
  }
  await mkdir(project.outDir, { recursive: true });
  await writeFile(path.join(project.outDir, ENTRY_FILE), build.code);
  const file = path.join(project.outDir, `${project.manifest.id}-${project.manifest.version}${PACKAGE_EXTENSION}`);
  await writeFile(file, archive);
  return { file, bytes: archive.byteLength, sha256: sha256(archive), keyId: key?.keyId, warnings: build.warnings };
}
