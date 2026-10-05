import { File, Paths } from 'expo-file-system';

let nextImageFileId = 0;

export function createReaderImageFile(source: string, bytes: Uint8Array): string {
  const extension =
    source
      .split(/[?#]/, 1)[0]
      ?.match(/\.(png|jpe?g|gif|webp|avif|svg|heic|heif)$/i)?.[1]
      ?.toLowerCase() ?? 'png';
  const file = new File(Paths.cache, `lunar-reader-image-${Date.now()}-${++nextImageFileId}.${extension}`);
  file.create();
  try {
    file.write(bytes);
    return file.uri;
  } catch (error) {
    file.delete();
    throw error;
  }
}

export function deleteReaderImageFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The cache may already have been removed by the operating system.
  }
}
