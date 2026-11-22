import type { SQLiteDatabase } from 'expo-sqlite';

import type { PluginDownloadRecord } from '../domain/plugin-download';
import type { PluginDownloadRepository } from './plugin-download-repository';

interface DownloadRow {
  readonly record_json: string;
}

export class SQLitePluginDownloadRepository implements PluginDownloadRepository {
  constructor(private readonly database: SQLiteDatabase) {}

  async list(): Promise<readonly PluginDownloadRecord[]> {
    const rows = await this.database.getAllAsync<DownloadRow>(
      'SELECT record_json FROM plugin_downloads ORDER BY created_at',
    );
    return rows.flatMap((row) => {
      try {
        const record = JSON.parse(row.record_json) as PluginDownloadRecord;
        return typeof record?.id === 'string' && typeof record.pluginId === 'string' ? [record] : [];
      } catch {
        return [];
      }
    });
  }

  async save(record: PluginDownloadRecord): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO plugin_downloads (id, plugin_id, status, record_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         record_json = excluded.record_json,
         updated_at = excluded.updated_at`,
      record.id,
      record.pluginId,
      record.status,
      JSON.stringify(record),
      record.createdAt,
      record.updatedAt,
    );
  }

  async remove(id: string): Promise<void> {
    await this.database.runAsync('DELETE FROM plugin_downloads WHERE id = ?', id);
  }
}
