import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'react-native';
import type { PosterBook } from '../domain/poster';
let posterFileSequence = 0;

export class PosterPermissionError extends Error {
  constructor(readonly canAskAgain: boolean) {
    super('Poster photo permission denied');
  }
}
/** Check local image availability in bounded batches. Invalid covers explicitly fall back to a title tile. */
export async function preparePosterBooks(books: readonly PosterBook[], signal: { aborted: boolean }) {
  const result: PosterBook[] = [];
  for (let i = 0; i < books.length; i += 4) {
    if (signal.aborted) throw Error('Preparation cancelled');
    const batch = await Promise.all(
      books.slice(i, i + 4).map(async (book) => {
        if (!book.coverUri) return book;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Image.getSize(book.coverUri),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error('Cover timed out')), 10000);
            }),
          ]);
          return book;
        } catch {
          return { ...book, coverUri: null };
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    result.push(...batch);
  }
  return result;
}
export async function requestPosterPhotoPermission() {
  const p = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (!p.granted) throw new PosterPermissionError(p.canAskAgain);
}
export async function writePosterImage(base64: string, page: number) {
  if (!FileSystem.cacheDirectory) throw Error('Cache is unavailable');
  // A share receiver can continue reading after Android's chooser returns. Keep shared
  // files for a day; collect old poster cache entries on the next export.
  try {
    const directory = FileSystem.cacheDirectory;
    const names = await FileSystem.readDirectoryAsync(directory);
    await Promise.allSettled(
      names
        .filter((name) => {
          const match = /^lunar-poster-(\d+)-(?:\d+-)?\d+\.png$/.exec(name);
          return match && Date.now() - Number(match[1]) > 86400000;
        })
        .map((name) => FileSystem.deleteAsync(directory + name, { idempotent: true })),
    );
  } catch {
    /* Cache housekeeping must not block delivery. */
  }
  const uri = FileSystem.cacheDirectory + `lunar-poster-${Date.now()}-${++posterFileSequence}-${page}.png`;
  try {
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return uri;
  } catch (error) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    throw error;
  }
}
export async function removePosterImage(uri: string) {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}
export async function savePosterImage(uri: string) {
  await MediaLibrary.Asset.create(uri);
}
export async function sharePosterImage(uri: string, title: string) {
  if (!(await Sharing.isAvailableAsync())) throw Error('Sharing unavailable');
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: title });
}
