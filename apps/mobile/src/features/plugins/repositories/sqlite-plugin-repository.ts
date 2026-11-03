import type { SQLiteDatabase } from 'expo-sqlite';
import { parsePluginManifest } from '@umbrae-labs/lunar-plugin-sdk/manifest';
import type { PluginSource } from '@umbrae-labs/lunar-plugin-sdk';

import type { InstalledPlugin, PluginLocales } from '../domain/installed-plugin';
import type { PluginRecordRepository, PluginStorageRepository } from './plugin-repository';

interface PluginRow {
  readonly id: string;
  readonly version: string;
  readonly source: string;
  readonly manifest_json: string;
  readonly locales_json: string;
  readonly package_sha256: string;
  readonly entry_sha256: string;
  readonly directory_uri: string;
  readonly installed_at: number;
  readonly updated_at: number;
  readonly previous_json: string | null;
  readonly signer_key_id: string | null;
}

export class SQLitePluginRecordRepository implements PluginRecordRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async list(): Promise<readonly InstalledPlugin[]> {
    const rows = await this.database.getAllAsync<PluginRow>('SELECT * FROM plugins ORDER BY id');
    return rows.flatMap((row) => {
      // A record whose manifest no longer validates stays out of the runtime.
      const plugin = toInstalledPlugin(row);
      if (!plugin) return [];
      const previous = row.previous_json ? parseJson(row.previous_json) : undefined;
      const previousPlugin =
        previous && typeof previous === 'object' ? toInstalledPlugin(previous as PluginRow) : undefined;
      return [previousPlugin?.id === plugin.id ? { ...plugin, previous: previousPlugin } : plugin];
    });
  }

  async save(plugin: InstalledPlugin): Promise<void> {
    const row = toRow(plugin);
    const previous = plugin.previous ? toRow(plugin.previous) : undefined;
    await this.database.runAsync(
      `INSERT INTO plugins (id, version, source, manifest_json, locales_json, package_sha256, entry_sha256,
         directory_uri, installed_at, updated_at, previous_json, signer_key_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         version = excluded.version,
         source = excluded.source,
         manifest_json = excluded.manifest_json,
         locales_json = excluded.locales_json,
         package_sha256 = excluded.package_sha256,
         entry_sha256 = excluded.entry_sha256,
         directory_uri = excluded.directory_uri,
         updated_at = excluded.updated_at,
         previous_json = excluded.previous_json,
         signer_key_id = excluded.signer_key_id`,
      row.id,
      row.version,
      row.source,
      row.manifest_json,
      row.locales_json,
      row.package_sha256,
      row.entry_sha256,
      row.directory_uri,
      row.installed_at,
      row.updated_at,
      previous ? JSON.stringify(previous) : null,
      row.signer_key_id,
    );
  }

  async remove(pluginId: string): Promise<void> {
    await this.database.runAsync('DELETE FROM plugins WHERE id = ?', pluginId);
  }
}

export class SQLitePluginStorageRepository implements PluginStorageRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async get(pluginId: string, key: string): Promise<string | undefined> {
    const row = await this.database.getFirstAsync<{ value_json: string }>(
      'SELECT value_json FROM plugin_storage WHERE plugin_id = ? AND key = ?',
      pluginId,
      key,
    );
    return row?.value_json;
  }

  async set(pluginId: string, key: string, valueJson: string, byteSize: number): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO plugin_storage (plugin_id, key, value_json, byte_size, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(plugin_id, key) DO UPDATE SET
         value_json = excluded.value_json,
         byte_size = excluded.byte_size,
         updated_at = excluded.updated_at`,
      pluginId,
      key,
      valueJson,
      byteSize,
      Date.now(),
    );
  }

  async delete(pluginId: string, key: string): Promise<void> {
    await this.database.runAsync('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?', pluginId, key);
  }

  async keys(pluginId: string, prefix = ''): Promise<readonly string[]> {
    const rows = await this.database.getAllAsync<{ key: string }>(
      // substr comparison avoids LIKE wildcards in plugin-chosen prefixes.
      'SELECT key FROM plugin_storage WHERE plugin_id = ? AND substr(key, 1, ?) = ? ORDER BY key',
      pluginId,
      prefix.length,
      prefix,
    );
    return rows.map((row) => row.key);
  }

  async totalBytes(pluginId: string, excludingKey?: string): Promise<number> {
    const row = await this.database.getFirstAsync<{ total: number | null }>(
      'SELECT SUM(byte_size) AS total FROM plugin_storage WHERE plugin_id = ? AND key IS NOT ?',
      pluginId,
      excludingKey ?? null,
    );
    return row?.total ?? 0;
  }

  async clear(pluginId: string): Promise<void> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('DELETE FROM plugin_storage WHERE plugin_id = ?', pluginId);
      await transaction.runAsync('DELETE FROM plugin_storage_backups WHERE plugin_id = ?', pluginId);
      await transaction.runAsync('DELETE FROM plugin_data WHERE plugin_id = ?', pluginId);
    });
  }

  async getDataVersion(pluginId: string): Promise<number | undefined> {
    const row = await this.database.getFirstAsync<{ data_version: number }>(
      'SELECT data_version FROM plugin_data WHERE plugin_id = ?',
      pluginId,
    );
    return row?.data_version;
  }

  async setDataVersion(pluginId: string, version: number): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO plugin_data (plugin_id, data_version) VALUES (?, ?)
       ON CONFLICT(plugin_id) DO UPDATE SET data_version = excluded.data_version`,
      pluginId,
      version,
    );
  }

  async snapshot(pluginId: string): Promise<void> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('DELETE FROM plugin_storage_backups WHERE plugin_id = ?', pluginId);
      await transaction.runAsync(
        `INSERT INTO plugin_storage_backups (plugin_id, key, value_json, byte_size, updated_at)
         SELECT plugin_id, key, value_json, byte_size, updated_at FROM plugin_storage WHERE plugin_id = ?`,
        pluginId,
      );
      // Data without a recorded version predates data versions and counts as version 1.
      await transaction.runAsync(
        `INSERT INTO plugin_data (plugin_id, data_version, backup_data_version) VALUES (?, 1, 1)
         ON CONFLICT(plugin_id) DO UPDATE SET backup_data_version = data_version`,
        pluginId,
      );
    });
  }

  async restoreSnapshot(pluginId: string): Promise<boolean> {
    let restored = false;
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      const row = await transaction.getFirstAsync<{ backup_data_version: number | null }>(
        'SELECT backup_data_version FROM plugin_data WHERE plugin_id = ?',
        pluginId,
      );
      if (row?.backup_data_version == null) return;
      await transaction.runAsync('DELETE FROM plugin_storage WHERE plugin_id = ?', pluginId);
      await transaction.runAsync(
        `INSERT INTO plugin_storage (plugin_id, key, value_json, byte_size, updated_at)
         SELECT plugin_id, key, value_json, byte_size, updated_at FROM plugin_storage_backups WHERE plugin_id = ?`,
        pluginId,
      );
      await transaction.runAsync('DELETE FROM plugin_storage_backups WHERE plugin_id = ?', pluginId);
      await transaction.runAsync(
        'UPDATE plugin_data SET data_version = backup_data_version, backup_data_version = NULL WHERE plugin_id = ?',
        pluginId,
      );
      restored = true;
    });
    return restored;
  }

  async dropSnapshot(pluginId: string): Promise<void> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync('DELETE FROM plugin_storage_backups WHERE plugin_id = ?', pluginId);
      await transaction.runAsync('UPDATE plugin_data SET backup_data_version = NULL WHERE plugin_id = ?', pluginId);
    });
  }
}

function toInstalledPlugin(row: PluginRow): InstalledPlugin | undefined {
  const parsed = typeof row.manifest_json === 'string' ? parseJson(row.manifest_json) : undefined;
  const manifest = parsed === undefined ? undefined : parsePluginManifest(parsed);
  if (!manifest?.ok || manifest.manifest.id !== row.id) return undefined;
  return {
    id: row.id,
    version: row.version,
    source: (row.source === 'official' ? 'official' : 'community') as PluginSource,
    manifest: manifest.manifest,
    locales: (parseJson(row.locales_json) ?? {}) as PluginLocales,
    packageSha256: row.package_sha256,
    entrySha256: row.entry_sha256,
    directoryUri: row.directory_uri,
    signerKeyId: row.signer_key_id ?? undefined,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}

function toRow(plugin: InstalledPlugin): Omit<PluginRow, 'previous_json'> {
  if (!plugin.directoryUri || !plugin.packageSha256 || !plugin.entrySha256) {
    throw new Error('Only installed packages can be saved');
  }
  return {
    id: plugin.id,
    version: plugin.version,
    source: plugin.source,
    manifest_json: JSON.stringify(plugin.manifest),
    locales_json: JSON.stringify(plugin.locales),
    package_sha256: plugin.packageSha256,
    entry_sha256: plugin.entrySha256,
    directory_uri: plugin.directoryUri,
    signer_key_id: plugin.signerKeyId ?? null,
    installed_at: plugin.installedAt,
    updated_at: plugin.updatedAt,
  };
}

function parseJson(text: string): unknown {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
