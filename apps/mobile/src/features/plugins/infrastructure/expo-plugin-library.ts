import { Directory, File, Paths } from 'expo-file-system';
import type { EpubImport } from '@umbrae-labs/lunar-plugin-sdk';

import { importEpubFile } from '@/features/library';
import type { PluginImportedBook } from '../services/plugin-host';
import { releaseSharedObject, writeFileBytesAsync } from './expo-plugin-io';

let stagingSequence = 0;

/**
 * Stages plugin bytes as a temporary file using bounded `FileHandle.writeBytes`
 * chunks, then delegates to the normal library import pipeline without retaining
 * `input.bytes` in any async closure during import.
 */
export function importPluginEpub(input: EpubImport): Promise<PluginImportedBook> {
  const { fileName, onProgress } = input;
  return writeStagingEpub(input.bytes).then((stagingUri) => finishStagedImport(stagingUri, fileName, onProgress));
}

async function writeStagingEpub(bytes: Uint8Array): Promise<string> {
  const directory = new Directory(Paths.cache, 'plugin-imports');
  let staging: File | undefined;
  try {
    directory.create({ intermediates: true, idempotent: true });
    stagingSequence += 1;
    staging = new File(directory, `${Date.now()}-${stagingSequence}.epub`);
    await writeFileBytesAsync(staging, bytes);
    return staging.uri;
  } catch (error) {
    if (staging) {
      try {
        if (staging.exists) staging.delete();
      } catch {
        // Best-effort cleanup of a partial staging file.
      }
    }
    throw error;
  } finally {
    releaseSharedObject(staging);
    releaseSharedObject(directory);
  }
}

async function finishStagedImport(
  stagingUri: string,
  fileName: string,
  onProgress?: (progress: number) => void,
): Promise<PluginImportedBook> {
  try {
    const book = await importEpubFile({ uri: stagingUri, fileName }, onProgress);
    return { id: book.id, title: book.title, author: book.author, language: book.language, coverUri: book.coverUri };
  } finally {
    const staging = new File(stagingUri);
    try {
      if (staging.exists) staging.delete();
    } catch {
      // The cache directory is disposable; a failed cleanup must not undo an import.
    } finally {
      releaseSharedObject(staging);
    }
  }
}
