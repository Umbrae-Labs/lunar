import { File } from 'expo-file-system';

import { i18n } from '@/i18n';

export async function readReaderBook(fileUri: string): Promise<ArrayBuffer> {
  const file = new File(fileUri);
  if (!file.exists) {
    throw new Error(i18n.t('reader.fileMissing'));
  }
  return file.arrayBuffer();
}
