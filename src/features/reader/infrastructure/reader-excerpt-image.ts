import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import { captureRef } from 'react-native-view-shot';

/** Captures the rendered excerpt card as a PNG file in the app's temporary storage. */
export function captureReaderExcerpt<T>(ref: RefObject<T>): Promise<string> {
  if (!ref.current) return Promise.reject(new Error('Excerpt card is not ready'));
  return captureRef(ref, {
    format: 'png',
    result: 'tmpfile',
    quality: 1,
    fileName: 'lunar-excerpt.png',
  });
}

export async function saveReaderExcerptToLibrary<T>(ref: RefObject<T>): Promise<void> {
  const uri = await captureReaderExcerpt(ref);
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (permission.status !== 'granted') throw new Error('Media library permission was not granted');
  await MediaLibrary.saveToLibraryAsync(uri);
}

export async function shareReaderExcerpt<T>(ref: RefObject<T>, dialogTitle: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable');
  const uri = await captureReaderExcerpt(ref);
  await Sharing.shareAsync(uri, {
    mimeType: 'image/png',
    UTI: 'public.png',
    dialogTitle,
  });
}
