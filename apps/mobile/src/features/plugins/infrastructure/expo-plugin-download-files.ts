import { Directory, File, Paths } from 'expo-file-system';

import type { PluginDownloadFiles } from '../repositories/plugin-download-repository';
import { releaseSharedObject, writeFileBytesAsync } from './expo-plugin-io';

const DOWNLOADS_DIRECTORY = 'plugin-downloads';

function directory(downloadId: string): Directory {
  return new Directory(Paths.document, DOWNLOADS_DIRECTORY, downloadId);
}

/** Download files under `plugin-downloads/<download id>/`; names are validated by the queue. */
export const expoPluginDownloadFiles: PluginDownloadFiles = {
  async write(downloadId, name, bytes) {
    const parent = directory(downloadId);
    let file: File | undefined;
    try {
      parent.create({ intermediates: true, idempotent: true });
      file = new File(parent, name);
      await writeFileBytesAsync(file, bytes);
    } finally {
      releaseSharedObject(file);
      releaseSharedObject(parent);
    }
  },
  async read(downloadId, name) {
    const parent = directory(downloadId);
    const file = new File(parent, name);
    try {
      return file.exists ? await file.bytes() : undefined;
    } finally {
      releaseSharedObject(file);
      releaseSharedObject(parent);
    }
  },
  async has(downloadId, name) {
    const parent = directory(downloadId);
    const file = new File(parent, name);
    try {
      return file.exists;
    } finally {
      releaseSharedObject(file);
      releaseSharedObject(parent);
    }
  },
  async delete(downloadId, name) {
    const parent = directory(downloadId);
    const file = new File(parent, name);
    try {
      if (file.exists) file.delete();
    } finally {
      releaseSharedObject(file);
      releaseSharedObject(parent);
    }
  },
  async list(downloadId) {
    const parent = directory(downloadId);
    try {
      if (!parent.exists) return [];
      const items = parent.list();
      try {
        return items.flatMap((item) => (item instanceof File ? [item.name] : []));
      } finally {
        for (const item of items) releaseSharedObject(item);
      }
    } finally {
      releaseSharedObject(parent);
    }
  },
  async clear(downloadId) {
    const parent = directory(downloadId);
    try {
      if (parent.exists) parent.delete();
    } finally {
      releaseSharedObject(parent);
    }
  },
  async owners() {
    const root = new Directory(Paths.document, DOWNLOADS_DIRECTORY);
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
  },
};
