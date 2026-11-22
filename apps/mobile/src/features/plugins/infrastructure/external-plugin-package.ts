import { requireOptionalNativeModule } from 'expo';
import { File } from 'expo-file-system';
import { PACKAGE_EXTENSION, PACKAGE_LIMITS } from '@umbrae-labs/lunar-plugin-sdk/package-format';

import type { PickedPluginPackage } from './expo-plugin-files';

interface FileNameModule {
  fileName(uri: string): Promise<string | null>;
}

/** Whether an opened `content://` or `file://` URI names a plugin package. */
export async function isExternalPluginPackage(uri: string): Promise<boolean> {
  if (!/^(content|file):\/\//i.test(uri)) return false;
  let name: string | null | undefined;
  if (/^file:\/\//i.test(uri)) {
    name = new File(uri).name;
  } else {
    // Content URIs are opaque; the provider's display name carries the extension.
    name = await requireOptionalNativeModule<FileNameModule>('LunarEpubReceiver')
      ?.fileName(uri)
      .catch(() => null);
  }
  return name?.toLowerCase().endsWith(PACKAGE_EXTENSION) ?? false;
}

/** Reads an opened package while the sending application's read grant is still valid. */
export async function readExternalPluginPackage(uri: string): Promise<PickedPluginPackage> {
  const file = new File(uri);
  if (file.size > PACKAGE_LIMITS.archiveBytes) {
    throw new Error(`The plugin package exceeds the ${PACKAGE_LIMITS.archiveBytes / 1024 / 1024} MiB limit.`);
  }
  return { name: file.name, bytes: await file.bytes() };
}
