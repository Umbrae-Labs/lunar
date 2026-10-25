import { i18n } from '@/i18n';
import { inspectReaderBookLayout, LunarReaderError, READER_ERROR_CODES, type ReaderOpenRequest } from '@/reader';
import { readReaderBook } from '../infrastructure/expo-reader-book-loader';

/** Gate unsupported layouts before any native session or page is created. */
export async function loadReaderBook(request: ReaderOpenRequest): Promise<ArrayBuffer> {
  const data = await readReaderBook(request.fileUri);
  if (!request.allowUnsupportedFixedLayout) {
    const layout = inspectReaderBookLayout(data);
    if (layout.kind !== 'reflowable') {
      throw new LunarReaderError(READER_ERROR_CODES.unsupportedFixedLayout, i18n.t('reader.fixedLayoutDescription'), {
        layout,
      });
    }
  }
  return data;
}
