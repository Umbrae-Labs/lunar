import { File } from 'expo-file-system';

import type { LibraryBookRecord } from '../domain/library-book';
import { stageExternalEpub, takeInitialEpubShares } from '../infrastructure/external-epub-receiver';
import { importEpubFile } from './library-service';

export type ExternalImportResult =
  { readonly book: LibraryBookRecord; readonly error?: never } | { readonly error: unknown; readonly book?: never };

const requests = new Map<string, Promise<readonly ExternalImportResult[]>>();
let sequence = 0;
let importQueue: Promise<unknown> = Promise.resolve();

export function createExternalImport(uris: readonly string[]): string {
  const requestId = String(++sequence);
  // Copy while the sending application's temporary read grant is available.
  // Handle rejection immediately, even while an earlier import is running.
  const staged = [...new Set(uris)].map((uri) =>
    stageExternalEpub(uri).then(
      (file) => ({ file }),
      (error: unknown) => ({ error }),
    ),
  );
  const result = importQueue.then(async () => {
    const results: ExternalImportResult[] = [];
    for (const pending of staged) {
      const source = await pending;
      if ('error' in source) {
        results.push({ error: source.error });
        continue;
      }
      try {
        results.push({ book: await importEpubFile(source.file) });
      } catch (error) {
        results.push({ error });
      } finally {
        try {
          new File(source.file.uri).delete();
        } catch {
          // Cache files can also be reclaimed by the operating system.
        }
      }
    }
    return results;
  });
  requests.set(requestId, result);
  importQueue = result.catch(() => undefined);
  return `/import-epub?requestId=${requestId}`;
}

export function getExternalImport(requestId: string): Promise<readonly ExternalImportResult[]> | undefined {
  return requests.get(requestId);
}

export function releaseExternalImport(requestId: string): void {
  requests.delete(requestId);
}

export function redirectExternalEpub({ path, initial }: { path: string; initial: boolean }): string {
  if (initial) {
    const shares = takeInitialEpubShares();
    if (shares.length > 0) return createExternalImport(shares);
  }
  if (/^(content|file):\/\//i.test(path)) {
    return createExternalImport([path]);
  }
  return path;
}
