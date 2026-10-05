import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

const FONT_DIRECTORY_NAME = 'fonts';
const DEFAULT_FONT_EXTENSION = '.ttf';

/** A font file that has been copied into managed storage. */
export interface StoredReaderFont {
  /** SHA-256 of the bytes, which doubles as the directory name and catalog id. */
  readonly id: string;
  readonly uri: string;
  readonly byteLength: number;
}

/**
 * Reads a picked font before it becomes managed, in order to hash and validate
 * it. The bytes are read once and reused for the digest, the format probe and
 * the write, since an imported CJK face can run to tens of megabytes.
 */
export async function readPickedFontBytes(uri: string): Promise<Uint8Array> {
  const source = new File(uri);
  if (!source.exists) {
    throw new Error('The selected font file cannot be read.');
  }
  return new Uint8Array(await source.arrayBuffer());
}

/**
 * Writes font bytes to `document/fonts/<sha256>/font.<ext>`, mirroring the
 * `books/<id>/book.epub` layout: one directory per file keeps deletion atomic,
 * and hashing the content makes re-importing the same file a no-op.
 */
export async function storeReaderFontBytes(bytes: Uint8Array, fileName: string): Promise<StoredReaderFont> {
  const id = bytesToHex(
    new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes as unknown as Uint8Array<ArrayBuffer>)),
  );
  const fontsDirectory = new Directory(Paths.document, FONT_DIRECTORY_NAME);
  fontsDirectory.create({ intermediates: true, idempotent: true });
  const fontDirectory = new Directory(fontsDirectory, id);
  fontDirectory.create({ intermediates: true, idempotent: true });
  const target = new File(fontDirectory, `font${fontExtension(fileName)}`);
  target.create({ overwrite: true, intermediates: true });
  target.write(bytes);
  return { id, uri: target.uri, byteLength: bytes.byteLength };
}

/** Reads a managed font back, or `undefined` when its file has gone missing. */
export async function readStoredFontBytes(uri: string): Promise<Uint8Array | undefined> {
  try {
    const file = new File(uri);
    if (!file.exists) {
      return undefined;
    }
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    return undefined;
  }
}

/** Deletes a managed font's directory. Best effort: the index is the truth. */
export function deleteStoredFont(uri: string): void {
  try {
    new File(uri).parentDirectory.delete();
  } catch {
    // A font whose files are already gone needs no cleanup.
  }
}

/**
 * The extension is cosmetic — both Rito and Skia decode from bytes — but it is
 * kept so the file stays recognisable when inspected on the device.
 */
function fontExtension(fileName: string): string {
  const separator = fileName.lastIndexOf('.');
  if (separator <= 0) {
    return DEFAULT_FONT_EXTENSION;
  }
  const extension = fileName.slice(separator).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(extension) ? extension : DEFAULT_FONT_EXTENSION;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
