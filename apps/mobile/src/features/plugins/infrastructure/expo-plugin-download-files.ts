import { Directory, File, Paths } from 'expo-file-system';

import type { PluginDownloadFiles } from '../repositories/plugin-download-repository';

const DOWNLOADS_DIRECTORY = 'plugin-downloads';

function directory(downloadId: string): Directory {
  return new Directory(Paths.document, DOWNLOADS_DIRECTORY, downloadId);
}

/** Download files under `plugin-downloads/<download id>/`; names are validated by the queue. */
export const expoPluginDownloadFiles: PluginDownloadFiles = {
  async write(downloadId, name, bytes) {
    const parent = directory(downloadId);
    parent.create({ intermediates: true, idempotent: true });
    const file = new File(parent, name);
    file.create({ intermediates: true, overwrite: true });
    file.write(bytes);
  },
  async read(downloadId, name) {
    const file = new File(directory(downloadId), name);
    return file.exists ? file.bytes() : undefined;
  },
  async has(downloadId, name) {
    return new File(directory(downloadId), name).exists;
  },
  async delete(downloadId, name) {
    const file = new File(directory(downloadId), name);
    if (file.exists) file.delete();
  },
  async list(downloadId) {
    const parent = directory(downloadId);
    if (!parent.exists) return [];
    return parent.list().flatMap((item) => (item instanceof File ? [item.name] : []));
  },
  async clear(downloadId) {
    const parent = directory(downloadId);
    if (parent.exists) parent.delete();
  },
  async owners() {
    const root = new Directory(Paths.document, DOWNLOADS_DIRECTORY);
    if (!root.exists) return [];
    return root.list().flatMap((item) => (item instanceof Directory ? [item.name] : []));
  },
};
