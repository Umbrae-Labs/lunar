import type {
  DownloadFiles,
  DownloadHandler,
  DownloadInfo,
  DownloadJob,
  DownloadOutput,
  DownloadProgress,
  EnqueueOptions,
  ImportedLibraryBook,
  JsonValue,
} from '@umbrae-labs/lunar-plugin-sdk';

import {
  FILE_DOWNLOAD_KIND,
  isFinishedDownload,
  toDownloadInfo,
  type DownloadPauseReason,
  type FileDownloadParams,
  type PluginDownloadRecord,
} from '../domain/plugin-download';
import { LunarPluginError, pluginErrorMessage } from '../domain/plugin-error';
import type { PluginDownloadFiles, PluginDownloadRepository } from '../repositories/plugin-download-repository';

export const DOWNLOAD_LIMITS = {
  /** Downloads running at once; each plugin runs one at a time. */
  running: 2,
  /** Automatic retries after a failed run, with these delays. */
  retryDelaysMs: [3_000, 15_000],
  paramsBytes: 64 * 1024,
  checkpointBytes: 256 * 1024,
  fileBytes: 32 * 1024 * 1024,
  files: 10_000,
  warnings: 20,
  outputBytes: 100 * 1024 * 1024,
  /** Finished downloads kept beyond this many are forgotten, oldest first. */
  finishedRecords: 200,
  progressNotifyMs: 150,
  /** A run that its plugin's stop interrupted starts again after this delay. */
  restartDelayMs: 500,
} as const;

const FileName = /^[A-Za-z0-9._-]{1,100}$/;
const NonRetryableCodes = new Set([
  'PERMISSION_DENIED',
  'INVALID_ARGUMENT',
  'CAPABILITY_UNAVAILABLE',
  'QUOTA_EXCEEDED',
  'INCOMPATIBLE_SDK',
  'MODULE_NOT_FOUND',
  'CREDENTIAL_REQUIRED',
]);

/** A host-side download entry: the record plus the plugin it belongs to. */
export type HostDownload = DownloadInfo & {
  readonly pluginId: string;
  readonly coverUri?: string;
  readonly pauseReason?: DownloadPauseReason;
};

/** What the queue needs from the plugin host. */
export interface PluginDownloadEnvironment {
  readonly repository: PluginDownloadRepository;
  readonly files: PluginDownloadFiles;
  /** Whether the plugin is installed and enabled. */
  isEnabled(pluginId: string): boolean;
  /**
   * Starts the plugin and returns its handler with the signal that ends with the plugin's
   * current run. Rejects when the plugin cannot start or registered no handler.
   */
  resolveHandler(
    pluginId: string,
    kind: string,
  ): Promise<{ readonly handler: DownloadHandler; readonly lifetime: AbortSignal }>;
  /** Fetches the file of a file download. */
  fetchFile(
    pluginId: string,
    params: FileDownloadParams,
    signal: AbortSignal,
    onProgress: (received: number, total: number | undefined) => void,
  ): Promise<Uint8Array>;
  sha256(bytes: Uint8Array): Promise<string>;
  importEpub(input: {
    readonly fileName: string;
    readonly bytes: Uint8Array;
    readonly onProgress: (progress: number) => void;
  }): Promise<ImportedLibraryBook & { readonly coverUri?: string }>;
  onCompleted?(download: HostDownload): void;
  onFailed?(download: HostDownload): void;
  log?(pluginId: string, level: 'info' | 'warn' | 'error', message: string): void;
  now?(): number;
  createId?(): string;
}

interface Run {
  readonly controller: AbortController;
  /** Set when the run stopped for a reason other than its own outcome. */
  stopped: boolean;
}

/**
 * Lunar's download queue. Records persist; runs stay in memory, so downloads that were running
 * when the app closed come back paused. Every state change is written before listeners hear it.
 */
export class PluginDownloadQueue {
  private readonly records = new Map<string, PluginDownloadRecord>();
  private readonly runs = new Map<string, Run>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Set<() => void>();
  private loading?: Promise<void>;
  private version = 0;
  private snapshot?: { readonly version: number; readonly downloads: readonly HostDownload[] };
  private readonly pluginSnapshots = new Map<string, { version: number; downloads: readonly DownloadInfo[] }>();
  private notifyTimer?: ReturnType<typeof setTimeout>;
  private writes: Promise<void> = Promise.resolve();
  private sequence = 0;

  constructor(private readonly environment: PluginDownloadEnvironment) {}

  private now(): number {
    return this.environment.now?.() ?? Date.now();
  }

  /** Loads stored downloads once. Downloads that were unfinished come back paused. */
  ready(): Promise<void> {
    this.loading ??= (async () => {
      const stored = await this.environment.repository.list();
      for (const record of stored) {
        const interrupted = record.status === 'running' || record.status === 'queued';
        const restored: PluginDownloadRecord = interrupted
          ? { ...record, status: 'paused', phase: undefined, pauseReason: 'interrupted', updatedAt: this.now() }
          : record;
        this.records.set(record.id, restored);
        if (interrupted) this.persist(restored);
      }
      // Files of downloads that no longer exist, such as ones removed while the app was closing.
      try {
        for (const owner of await this.environment.files.owners()) {
          const record = this.records.get(owner);
          if (!record || record.status === 'completed') await this.environment.files.clear(owner);
        }
      } catch {
        // Leftover files only cost space; loading must not fail because of them.
      }
      this.changed();
    })();
    return this.loading;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    void this.ready();
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Every download, newest first. The same array returns until something changes. */
  getSnapshot = (): readonly HostDownload[] => {
    if (this.snapshot?.version === this.version) return this.snapshot.downloads;
    const downloads = [...this.records.values()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((record) => this.hostDownload(record));
    this.snapshot = { version: this.version, downloads };
    return downloads;
  };

  /** One plugin's downloads, newest first. The same array returns until something changes. */
  list(pluginId: string): readonly DownloadInfo[] {
    const cached = this.pluginSnapshots.get(pluginId);
    if (cached?.version === this.version) return cached.downloads;
    const downloads = [...this.records.values()]
      .filter((record) => record.pluginId === pluginId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(toDownloadInfo);
    this.pluginSnapshots.set(pluginId, { version: this.version, downloads });
    return downloads;
  }

  get(id: string): PluginDownloadRecord | undefined {
    return this.records.get(id);
  }

  async enqueue(
    pluginId: string,
    kind: string,
    params: JsonValue,
    options: EnqueueOptions,
  ): Promise<PluginDownloadRecord> {
    await this.ready();
    if (options.key !== undefined) {
      const existing = [...this.records.values()].find(
        (record) => record.pluginId === pluginId && record.key === options.key && record.status !== 'completed',
      );
      if (existing) {
        if (options.coverUrl && !existing.coverUrl) {
          this.update({ ...existing, coverUrl: options.coverUrl });
        }
        if (existing.status === 'paused' || existing.status === 'failed') this.resume(existing.id);
        return this.records.get(existing.id)!;
      }
    }
    const now = this.now();
    const record: PluginDownloadRecord = {
      id: this.environment.createId?.() ?? `${now.toString(36)}-${(this.sequence += 1).toString(36)}`,
      pluginId,
      kind,
      title: options.title,
      subtitle: options.subtitle,
      coverUrl: options.coverUrl,
      key: options.key,
      params,
      status: 'queued',
      attempts: 0,
      retries: 0,
      warnings: [],
      createdAt: now,
      updatedAt: now,
    };
    this.update(record);
    this.prune();
    this.pump();
    return this.records.get(record.id)!;
  }

  pause(id: string): void {
    const record = this.records.get(id);
    if (!record || (record.status !== 'queued' && record.status !== 'running')) return;
    // An import already under way finishes; the book would arrive either way.
    if (record.phase === 'importing') return;
    this.stopRun(id);
    this.update({ ...record, status: 'paused', phase: undefined, pauseReason: 'user' });
    this.pump();
  }

  resume(id: string): void {
    const record = this.records.get(id);
    if (!record || (record.status !== 'paused' && record.status !== 'failed')) return;
    this.update({ ...record, status: 'queued', retries: 0, error: undefined, pauseReason: undefined });
    this.pump();
  }

  async remove(id: string): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    this.stopRun(id);
    this.records.delete(id);
    this.changed();
    await this.write(async () => {
      await this.environment.repository.remove(id);
      await this.environment.files.clear(id);
    });
    this.pump();
  }

  /** Forgets completed and failed downloads. */
  async clearFinished(pluginId?: string): Promise<void> {
    const finished = [...this.records.values()].filter(
      (record) => isFinishedDownload(record) && (pluginId === undefined || record.pluginId === pluginId),
    );
    await Promise.all(finished.map((record) => this.remove(record.id)));
  }

  /** Forgets every download of an uninstalled plugin. */
  async removePlugin(pluginId: string): Promise<void> {
    await this.ready();
    const owned = [...this.records.values()].filter((record) => record.pluginId === pluginId);
    await Promise.all(owned.map((record) => this.remove(record.id)));
  }

  /** Waits until every state change so far is stored; for tests and orderly shutdown. */
  flush(): Promise<void> {
    return this.writes;
  }

  /** Starts queued downloads while slots are free, oldest first, one per plugin. */
  pump(): void {
    const records = [...this.records.values()];
    const running = records.filter((record) => record.status === 'running');
    const busy = new Set(running.map((record) => record.pluginId));
    let slots = DOWNLOAD_LIMITS.running - running.length;
    const queued = records
      .filter((record) => record.status === 'queued' && !this.retryTimers.has(record.id))
      .sort((left, right) => left.createdAt - right.createdAt);
    for (const record of queued) {
      if (slots <= 0) break;
      if (busy.has(record.pluginId)) continue;
      busy.add(record.pluginId);
      slots -= 1;
      this.start(record);
    }
  }

  private start(record: PluginDownloadRecord): void {
    const run: Run = { controller: new AbortController(), stopped: false };
    this.runs.set(record.id, run);
    const running = this.update({
      ...record,
      status: 'running',
      phase: 'downloading',
      attempts: record.attempts + 1,
      error: undefined,
      pauseReason: undefined,
    });
    void this.execute(running, run);
  }

  private stopRun(id: string): void {
    const timer = this.retryTimers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.retryTimers.delete(id);
    }
    const run = this.runs.get(id);
    if (!run) return;
    run.stopped = true;
    this.runs.delete(id);
    run.controller.abort();
  }

  private isCurrent(id: string, run: Run): boolean {
    return this.runs.get(id) === run && !run.stopped;
  }

  private async execute(record: PluginDownloadRecord, run: Run): Promise<void> {
    const { id, pluginId } = record;
    const signal = run.controller.signal;
    try {
      if (!this.environment.isEnabled(pluginId)) {
        this.stopRun(id);
        this.update({ ...this.records.get(id)!, status: 'paused', phase: undefined, pauseReason: 'disabled' });
        return;
      }
      let output: DownloadOutput | undefined;
      if (record.kind === FILE_DOWNLOAD_KIND) {
        output = await this.fetchFile(record, run);
      } else {
        const { handler, lifetime } = await this.environment.resolveHandler(pluginId, record.kind);
        if (!this.isCurrent(id, run)) return;
        const onStop = () => this.interrupt(id, run);
        if (lifetime.aborted) {
          onStop();
          return;
        }
        lifetime.addEventListener('abort', onStop, { once: true });
        try {
          output = await handler(this.createJob(record, run));
        } finally {
          lifetime.removeEventListener('abort', onStop);
        }
      }
      if (!this.isCurrent(id, run)) return;
      signal.throwIfAborted?.();
      let validated: DownloadOutput | undefined = validateOutput(output);
      const fileName = validated.fileName;
      let bytes: Uint8Array | undefined = validated.bytes;
      validated = undefined;
      output = undefined;
      this.update({ ...this.records.get(id)!, phase: 'importing', progress: { completed: 0, total: 100 } });
      const importPromise = this.environment.importEpub({
        fileName,
        bytes: bytes!,
        onProgress: (progress) =>
          this.setProgress(id, run, { completed: Math.round(Math.min(Math.max(progress, 0), 1) * 100), total: 100 }),
      });
      // Drop the in-memory EPUB reference before awaiting so Hermes can reclaim it
      // immediately after the importer stages it to disk.
      bytes = undefined;
      const book = await importPromise;
      // A removed download still leaves its book in the library.
      if (this.runs.get(id) !== run) return;
      this.runs.delete(id);
      const completed = this.update({
        ...this.records.get(id)!,
        status: 'completed',
        phase: undefined,
        progress: undefined,
        checkpoint: undefined,
        bookId: book.id,
        coverUri: book.coverUri ?? this.records.get(id)!.coverUri,
      });
      void this.write(() => this.environment.files.clear(id));
      this.environment.log?.(pluginId, 'info', `Download "${record.title}" imported as ${book.id}`);
      this.environment.onCompleted?.(this.hostDownload(completed));
      this.prune();
    } catch (error) {
      if (!this.isCurrent(id, run)) return;
      this.runs.delete(id);
      this.fail(this.records.get(id)!, error);
    } finally {
      this.pump();
    }
  }

  /** The plugin stopped under a running download; it runs again with the plugin's next start. */
  private interrupt(id: string, run: Run): void {
    if (!this.isCurrent(id, run)) return;
    this.stopRun(id);
    const record = this.records.get(id);
    if (!record) return;
    this.update({ ...record, status: 'queued', phase: undefined });
    this.retryLater(id, DOWNLOAD_LIMITS.restartDelayMs);
  }

  private fail(record: PluginDownloadRecord, error: unknown): void {
    const message = pluginErrorMessage(error).slice(0, 500);
    this.environment.log?.(record.pluginId, 'warn', `Download "${record.title}" failed: ${message}`);
    const delay = DOWNLOAD_LIMITS.retryDelaysMs[record.retries];
    if (delay !== undefined && record.phase !== 'importing' && isRetryable(error)) {
      this.update({ ...record, status: 'queued', phase: undefined, retries: record.retries + 1, error: message });
      this.retryLater(record.id, delay);
      return;
    }
    const failed = this.update({ ...record, status: 'failed', phase: undefined, error: message });
    this.environment.onFailed?.(this.hostDownload(failed));
  }

  private retryLater(id: string, delay: number): void {
    const timer = setTimeout(() => {
      this.retryTimers.delete(id);
      this.pump();
    }, delay);
    this.retryTimers.set(id, timer);
  }

  private createJob(record: PluginDownloadRecord, run: Run): DownloadJob {
    const { id } = record;
    const active = () => {
      if (!this.isCurrent(id, run)) throw new LunarPluginError('CANCELLED', 'The download is no longer running');
    };
    // File names are listed once per run and kept in step with writes and deletions.
    let names: Set<string> | undefined;
    const known = async () => (names ??= new Set(await this.environment.files.list(id)));
    const files: DownloadFiles = {
      write: async (name, bytes) => {
        active();
        validName(name);
        if (!(bytes instanceof Uint8Array)) throw new LunarPluginError('INVALID_ARGUMENT', 'File data must be bytes');
        if (bytes.byteLength > DOWNLOAD_LIMITS.fileBytes) {
          throw new LunarPluginError('QUOTA_EXCEEDED', 'A download file holds up to 32 MiB');
        }
        const existing = await known();
        if (!existing.has(name) && existing.size >= DOWNLOAD_LIMITS.files) {
          throw new LunarPluginError('QUOTA_EXCEEDED', 'A download holds up to 10000 files');
        }
        active();
        await this.environment.files.write(id, name, bytes);
        existing.add(name);
      },
      read: async (name) => {
        active();
        return this.environment.files.read(id, validName(name));
      },
      has: async (name) => {
        active();
        return (await known()).has(validName(name));
      },
      delete: async (name) => {
        active();
        await this.environment.files.delete(id, validName(name));
        (await known()).delete(name);
      },
      list: async () => {
        active();
        return [...(await known())].sort();
      },
    };
    return {
      id,
      params: record.params,
      attempt: record.attempts,
      signal: run.controller.signal,
      checkpoint: record.checkpoint,
      progress: (progress) => {
        if (this.isCurrent(id, run)) this.setProgress(id, run, validProgress(progress));
      },
      saveCheckpoint: async (state) => {
        active();
        const json = jsonText(state, 'The checkpoint');
        if (json.length > DOWNLOAD_LIMITS.checkpointBytes) {
          throw new LunarPluginError('QUOTA_EXCEEDED', 'A checkpoint holds up to 256 KiB');
        }
        this.update({ ...this.records.get(id)!, checkpoint: JSON.parse(json) as JsonValue });
        await this.writes;
      },
      warn: (message) => {
        if (!this.isCurrent(id, run)) return;
        const current = this.records.get(id)!;
        if (current.warnings.length >= DOWNLOAD_LIMITS.warnings) return;
        this.update({ ...current, warnings: [...current.warnings, String(message).slice(0, 300)] });
      },
      files,
    };
  }

  private async fetchFile(record: PluginDownloadRecord, run: Run): Promise<DownloadOutput> {
    const params = record.params as unknown as FileDownloadParams;
    const bytes = await this.environment.fetchFile(record.pluginId, params, run.controller.signal, (received, total) =>
      this.setProgress(record.id, run, { completed: received, total }),
    );
    if (params.size !== undefined && bytes.byteLength !== params.size) {
      throw new LunarPluginError(
        'INTEGRITY_FAILED',
        `The file has ${bytes.byteLength} bytes; ${params.size} were expected`,
        true,
      );
    }
    if (params.sha256 !== undefined && (await this.environment.sha256(bytes)) !== params.sha256) {
      throw new LunarPluginError('INTEGRITY_FAILED', 'The file does not match its SHA-256 checksum', true);
    }
    return { fileName: params.fileName, bytes };
  }

  /** Progress changes often; listeners hear about it at most every `progressNotifyMs`. */
  private setProgress(id: string, run: Run, progress: DownloadProgress): void {
    if (this.runs.get(id) !== run) return;
    const record = this.records.get(id);
    if (!record) return;
    this.records.set(id, { ...record, progress });
    if (this.notifyTimer !== undefined) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      this.changed();
    }, DOWNLOAD_LIMITS.progressNotifyMs);
  }

  /** Forgets the oldest finished downloads beyond the kept number. */
  private prune(): void {
    const finished = [...this.records.values()]
      .filter(isFinishedDownload)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    for (const record of finished.slice(DOWNLOAD_LIMITS.finishedRecords)) void this.remove(record.id);
  }

  private update(record: PluginDownloadRecord): PluginDownloadRecord {
    const next = { ...record, updatedAt: this.now() };
    this.records.set(next.id, next);
    this.persist(next);
    this.changed();
    return next;
  }

  private persist(record: PluginDownloadRecord): void {
    void this.write(async () => {
      // A removed record must not come back from a write queued before the removal.
      const current = this.records.get(record.id);
      if (current) await this.environment.repository.save(current);
    });
  }

  private write(task: () => Promise<void>): Promise<void> {
    const next = this.writes.then(task).catch((error: unknown) => {
      console.warn('[plugins] Saving a download failed', error);
    });
    this.writes = next;
    return next;
  }

  private changed(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  private hostDownload(record: PluginDownloadRecord): HostDownload {
    return {
      ...toDownloadInfo(record),
      pluginId: record.pluginId,
      coverUri: record.coverUri,
      pauseReason: record.pauseReason,
    };
  }
}

/** Parameters and checkpoints are JSON; `undefined` and functions are refused rather than dropped. */
export function jsonText(value: unknown, label: string): string {
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  if (json === undefined) throw new LunarPluginError('INVALID_ARGUMENT', `${label} must be JSON`);
  return json;
}

function validName(name: unknown): string {
  if (typeof name !== 'string' || !FileName.test(name) || name === '.' || name === '..') {
    throw new LunarPluginError(
      'INVALID_ARGUMENT',
      'File names use letters, digits, ".", "-" and "_", up to 100 characters',
    );
  }
  return name;
}

function validProgress(progress: DownloadProgress): DownloadProgress {
  const completed = Number(progress?.completed);
  const total = progress?.total === undefined ? undefined : Number(progress.total);
  if (!Number.isFinite(completed) || completed < 0 || (total !== undefined && (!Number.isFinite(total) || total < 0))) {
    throw new LunarPluginError('INVALID_ARGUMENT', 'Progress needs non-negative numbers');
  }
  return {
    completed,
    total,
    label: progress.label === undefined ? undefined : String(progress.label).slice(0, 200),
  };
}

function validateOutput(output: DownloadOutput): DownloadOutput {
  if (
    typeof output !== 'object' ||
    output === null ||
    typeof output.fileName !== 'string' ||
    output.fileName.length === 0 ||
    output.fileName.length > 200 ||
    !output.fileName.toLowerCase().endsWith('.epub') ||
    !(output.bytes instanceof Uint8Array)
  ) {
    throw new LunarPluginError('INVALID_ARGUMENT', 'A download must produce an EPUB file name and byte array');
  }
  if (output.bytes.byteLength > DOWNLOAD_LIMITS.outputBytes) {
    throw new LunarPluginError('QUOTA_EXCEEDED', 'The EPUB exceeds the 100 MiB import limit');
  }
  return output;
}

/** Errors marked `retryable: false`, and host errors a retry cannot fix, are final. */
function isRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return true;
  const { code, retryable } = error as { code?: unknown; retryable?: unknown };
  if (typeof code === 'string' && NonRetryableCodes.has(code)) return false;
  return retryable !== false;
}
