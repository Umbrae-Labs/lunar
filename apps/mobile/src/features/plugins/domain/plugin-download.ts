import type { DownloadInfo, DownloadProgress, DownloadStatus, JsonValue } from '@umbrae-labs/lunar-plugin-sdk';

/** Kind of the downloads Lunar fetches itself through `enqueueFile`. */
export const FILE_DOWNLOAD_KIND = 'lunar.file';

/** Why a download waits: the user paused it, the app closed while it ran, or its plugin stopped. */
export type DownloadPauseReason = 'user' | 'interrupted' | 'disabled';

/** What `enqueueFile` stores as the parameters of a file download. */
export interface FileDownloadParams {
  readonly url: string;
  readonly fileName: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly credential?: string;
  readonly sha256?: string;
  readonly size?: number;
}

/** A download as Lunar keeps it, including what plugins never see. */
export interface PluginDownloadRecord {
  readonly id: string;
  readonly pluginId: string;
  readonly kind: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly key?: string;
  readonly params: JsonValue;
  readonly status: DownloadStatus;
  readonly phase?: 'downloading' | 'importing';
  readonly progress?: DownloadProgress;
  readonly attempts: number;
  /** Automatic retries since the last run the user or plugin started. */
  readonly retries: number;
  readonly error?: string;
  readonly warnings: readonly string[];
  readonly bookId?: string;
  readonly checkpoint?: JsonValue;
  readonly pauseReason?: DownloadPauseReason;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export function isFinishedDownload(record: Pick<PluginDownloadRecord, 'status'>): boolean {
  return record.status === 'completed' || record.status === 'failed';
}

/** The part of a record a plugin reads. */
export function toDownloadInfo(record: PluginDownloadRecord): DownloadInfo {
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    subtitle: record.subtitle,
    key: record.key,
    status: record.status,
    phase: record.phase,
    progress: record.progress,
    attempts: record.attempts,
    error: record.error,
    warnings: record.warnings,
    bookId: record.bookId,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
