import type { PluginDownloadRecord } from '../domain/plugin-download';

/** Queued plugin downloads; a record's files live beside it in `PluginDownloadFiles`. */
export interface PluginDownloadRepository {
  list(): Promise<readonly PluginDownloadRecord[]>;
  save(record: PluginDownloadRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Files a plugin keeps for one download until it completes or is removed. */
export interface PluginDownloadFiles {
  write(downloadId: string, name: string, bytes: Uint8Array): Promise<void>;
  read(downloadId: string, name: string): Promise<Uint8Array | undefined>;
  has(downloadId: string, name: string): Promise<boolean>;
  delete(downloadId: string, name: string): Promise<void>;
  list(downloadId: string): Promise<readonly string[]>;
  clear(downloadId: string): Promise<void>;
  /** Download ids that have files, for removing leftovers. */
  owners(): Promise<readonly string[]>;
}
