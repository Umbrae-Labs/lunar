import { Directory, File, Paths } from 'expo-file-system';
import type { EpubImport, ImportedLibraryBook } from '@umbrae-labs/lunar-plugin-sdk';

import { importEpubFile } from '@/features/library';

let stagingSequence = 0;

/** Stages plugin bytes as a temporary file, then uses the normal library import pipeline. */
export async function importPluginEpub(input: EpubImport): Promise<ImportedLibraryBook> {
  const directory = new Directory(Paths.cache, 'plugin-imports');
  directory.create({ intermediates: true, idempotent: true });
  stagingSequence += 1;
  const staging = new File(directory, `${Date.now()}-${stagingSequence}.epub`);
  try {
    staging.create({ intermediates: true, overwrite: true });
    staging.write(input.bytes);
    const book = await importEpubFile({ uri: staging.uri, fileName: input.fileName }, input.onProgress);
    return { id: book.id, title: book.title, author: book.author, language: book.language };
  } finally {
    try {
      if (staging.exists) staging.delete();
    } catch {
      // The cache directory is disposable; a failed cleanup must not undo an import.
    }
  }
}
