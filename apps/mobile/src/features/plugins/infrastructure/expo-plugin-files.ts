import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { bytesToHex } from '@lunar/plugin-sdk/package-format';

const PLUGINS_DIRECTORY = 'plugins';

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>)));
}

/** Writes a validated package to `plugins/<id>/<version>` and returns the directory URI. */
export function writePluginFiles(pluginId: string, version: string, files: ReadonlyMap<string, Uint8Array>): string {
  const root = new Directory(Paths.document, PLUGINS_DIRECTORY, pluginId, version);
  if (root.exists) root.delete();
  root.create({ intermediates: true, idempotent: true });
  for (const [path, bytes] of files) {
    const segments = path.split('/');
    const name = segments.pop()!;
    const parent = segments.length > 0 ? new Directory(root, ...segments) : root;
    parent.create({ intermediates: true, idempotent: true });
    new File(parent, name).write(bytes);
  }
  return root.uri;
}

export async function readPluginText(directoryUri: string, path: string): Promise<string> {
  return new File(new Directory(directoryUri), ...path.split('/')).text();
}

/** File URI of a packaged file, for components that load it themselves. */
export function pluginFileUri(directoryUri: string, path: string): string {
  return new File(new Directory(directoryUri), ...path.split('/')).uri;
}

export async function readPluginBytes(directoryUri: string, path: string): Promise<Uint8Array> {
  return new File(new Directory(directoryUri), ...path.split('/')).bytes();
}

/** Removes versions of a plugin other than `keepVersions`, or all of them. */
export function deletePluginFiles(pluginId: string, keepVersions?: readonly string[]): void {
  const root = new Directory(Paths.document, PLUGINS_DIRECTORY, pluginId);
  if (!root.exists) return;
  if (!keepVersions) {
    root.delete();
    return;
  }
  for (const item of root.list()) {
    if (item instanceof Directory && !keepVersions.includes(item.name)) item.delete();
  }
}

/** Plugin directories on disk, for removing leftovers of uninstalled plugins. */
export function listPluginDirectories(): readonly string[] {
  const root = new Directory(Paths.document, PLUGINS_DIRECTORY);
  if (!root.exists) return [];
  return root.list().flatMap((item) => (item instanceof Directory ? [item.name] : []));
}

export interface PickedPluginPackage {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export async function pickPluginPackage(): Promise<PickedPluginPackage | undefined> {
  const result = await DocumentPicker.getDocumentAsync({
    // Custom extensions have no reliable MIME type. A single wildcard also avoids
    // Android's EXTRA_MIME_TYPES filter; the installer validates the package bytes.
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return undefined;
  const file = new File(asset.uri);
  try {
    return { name: asset.name, bytes: await file.bytes() };
  } finally {
    try {
      file.delete();
    } catch {
      // The picker's cache copy is best-effort cleanup.
    }
  }
}
