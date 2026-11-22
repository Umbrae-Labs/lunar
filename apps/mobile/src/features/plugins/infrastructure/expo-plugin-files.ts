import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import { releaseSharedObject, sha256Hex, writeFileBytes } from './expo-plugin-io';

const PLUGINS_DIRECTORY = 'plugins';

export { sha256Hex };

/** Writes a validated package to `plugins/<id>/<version>` and returns the directory URI. */
export function writePluginFiles(pluginId: string, version: string, files: ReadonlyMap<string, Uint8Array>): string {
  const root = new Directory(Paths.document, PLUGINS_DIRECTORY, pluginId, version);
  try {
    if (root.exists) root.delete();
    root.create({ intermediates: true, idempotent: true });
    for (const [path, bytes] of files) {
      const segments = path.split('/');
      const name = segments.pop()!;
      const parent = segments.length > 0 ? new Directory(root, ...segments) : undefined;
      let file: File | undefined;
      try {
        const container = parent ?? root;
        container.create({ intermediates: true, idempotent: true });
        file = new File(container, name);
        writeFileBytes(file, bytes);
      } finally {
        releaseSharedObject(file);
        releaseSharedObject(parent);
      }
    }
    return root.uri;
  } finally {
    releaseSharedObject(root);
  }
}

export async function readPluginText(directoryUri: string, path: string): Promise<string> {
  const root = new Directory(directoryUri);
  const file = new File(root, ...path.split('/'));
  try {
    return await file.text();
  } finally {
    releaseSharedObject(file);
    releaseSharedObject(root);
  }
}

/** File URI of a packaged file, for components that load it themselves. */
export function pluginFileUri(directoryUri: string, path: string): string {
  const root = new Directory(directoryUri);
  const file = new File(root, ...path.split('/'));
  try {
    return file.uri;
  } finally {
    releaseSharedObject(file);
    releaseSharedObject(root);
  }
}

export async function readPluginBytes(directoryUri: string, path: string): Promise<Uint8Array> {
  const root = new Directory(directoryUri);
  const file = new File(root, ...path.split('/'));
  try {
    return await file.bytes();
  } finally {
    releaseSharedObject(file);
    releaseSharedObject(root);
  }
}

/** Removes versions of a plugin other than `keepVersions`, or all of them. */
export function deletePluginFiles(pluginId: string, keepVersions?: readonly string[]): void {
  const root = new Directory(Paths.document, PLUGINS_DIRECTORY, pluginId);
  try {
    if (!root.exists) return;
    if (!keepVersions) {
      root.delete();
      return;
    }
    const items = root.list();
    try {
      for (const item of items) {
        if (item instanceof Directory && !keepVersions.includes(item.name)) item.delete();
      }
    } finally {
      for (const item of items) releaseSharedObject(item);
    }
  } finally {
    releaseSharedObject(root);
  }
}

/** Plugin directories on disk, for removing leftovers of uninstalled plugins. */
export function listPluginDirectories(): readonly string[] {
  const root = new Directory(Paths.document, PLUGINS_DIRECTORY);
  try {
    if (!root.exists) return [];
    const items = root.list();
    try {
      return items.flatMap((item) => (item instanceof Directory ? [item.name] : []));
    } finally {
      for (const item of items) releaseSharedObject(item);
    }
  } finally {
    releaseSharedObject(root);
  }
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
    } finally {
      releaseSharedObject(file);
    }
  }
}
