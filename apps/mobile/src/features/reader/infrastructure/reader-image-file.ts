import { File, FileMode, Paths } from 'expo-file-system';

const WRITE_CHUNK_BYTES = 512 * 1024;
let nextImageFileId = 0;

export function createReaderImageFile(source: string, bytes: Uint8Array): string {
  const extension =
    source
      .split(/[?#]/, 1)[0]
      ?.match(/\.(png|jpe?g|gif|webp|avif|svg|heic|heif)$/i)?.[1]
      ?.toLowerCase() ?? 'png';
  const file = new File(Paths.cache, `lunar-reader-image-${Date.now()}-${++nextImageFileId}.${extension}`);
  try {
    file.create({ overwrite: true });
    if (bytes.byteLength > 0) {
      const handle = file.open(FileMode.Truncate);
      try {
        for (let offset = 0; offset < bytes.byteLength; offset += WRITE_CHUNK_BYTES) {
          const end = Math.min(offset + WRITE_CHUNK_BYTES, bytes.byteLength);
          handle.writeBytes(offset === 0 && end === bytes.byteLength ? bytes : bytes.subarray(offset, end));
        }
      } finally {
        try {
          handle.close();
        } catch {
          // Best-effort handle close.
        }
        releaseSharedObject(handle);
      }
    }
    return file.uri;
  } catch (error) {
    try {
      if (file.exists) file.delete();
    } catch {
      // Best-effort cleanup of a partial cache file.
    }
    throw error;
  } finally {
    releaseSharedObject(file);
  }
}

export function deleteReaderImageFile(uri: string): void {
  const file = new File(uri);
  try {
    if (file.exists) file.delete();
  } catch {
    // The cache may already have been removed by the operating system.
  } finally {
    releaseSharedObject(file);
  }
}

function releaseSharedObject(object: unknown): void {
  if (!object || typeof object !== 'object') return;
  const release = (object as { release?: unknown }).release;
  if (typeof release !== 'function') return;
  try {
    release.call(object);
  } catch {
    // Shared objects may already be released.
  }
}
