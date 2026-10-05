import { probeReaderFontFile } from '@/reader/native';
import { useFontStore, type ImportedReaderFont } from '@/stores/font-store';
import { useReaderStore } from '@/stores/reader-store';
import { repairDanglingReaderFonts } from '../domain/reader-font-face';
import {
  deleteStoredFont,
  readPickedFontBytes,
  readStoredFontBytes,
  storeReaderFontBytes,
} from '../infrastructure/expo-reader-font-storage';
import { pickReaderFont } from '../infrastructure/reader-font-picker';

/**
 * Why an import was refused, as an i18n key suffix under `settings.fonts.errors`.
 * Every one of these is caught before the font reaches the catalog, because a
 * face the kernel cannot use does not fail politely: Rito rejects the whole
 * pinned set, which makes every book fail to open until the font is removed.
 */
export type ReaderFontImportFailure = 'unreadable' | 'tooLarge' | 'notAFont' | 'collection' | 'variable';

export type ReaderFontImportResult =
  | { readonly ok: true; readonly font: ImportedReaderFont }
  | { readonly ok: false; readonly reason: ReaderFontImportFailure };

/** A single face is decoded in full on the main thread; keep it bounded. */
const MAX_FONT_BYTES = 48 * 1024 * 1024;

/** Imports a font the user picked, or `undefined` when the picker was dismissed. */
export async function importReaderFont(): Promise<ReaderFontImportResult | undefined> {
  const picked = await pickReaderFont();
  if (!picked) {
    return undefined;
  }

  let bytes: Uint8Array;
  try {
    bytes = await readPickedFontBytes(picked.uri);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (bytes.byteLength === 0) {
    return { ok: false, reason: 'notAFont' };
  }
  if (bytes.byteLength > MAX_FONT_BYTES) {
    return { ok: false, reason: 'tooLarge' };
  }

  const probe = probeReaderFontFile(bytes);
  if (probe.collection) {
    return { ok: false, reason: 'collection' };
  }
  if (!probe.sfnt) {
    return { ok: false, reason: 'notAFont' };
  }
  if (probe.variable) {
    return { ok: false, reason: 'variable' };
  }

  const stored = await storeReaderFontBytes(bytes, picked.fileName);
  const font: ImportedReaderFont = {
    id: stored.id,
    family: probe.family ?? stripFontExtension(picked.fileName),
    fileName: picked.fileName,
    uri: stored.uri,
    byteLength: stored.byteLength,
    style: 'normal',
    weight: 400,
    addedAt: Date.now(),
  };
  useFontStore.getState().addFont(font);
  return { ok: true, font };
}

/**
 * Removes a font and repoints anything that selected it back at the bundled
 * face. Doing both together is what keeps a dangling reference from ever
 * reaching the kernel, where it would resolve to the bundled face silently
 * but leave the settings UI showing a font that no longer exists.
 */
export function removeReaderFont(id: string): void {
  const store = useFontStore.getState();
  const font = store.fonts.find((candidate) => candidate.id === id);
  if (!font) {
    return;
  }

  const { typography, setTypography } = useReaderStore.getState();
  const repaired = repairDanglingReaderFonts(
    typography,
    store.fonts.filter((candidate) => candidate.id !== id),
  );
  if (repaired) {
    setTypography(repaired);
  }
  store.removeFont(id);
  deleteStoredFont(font.uri);
}

export { readStoredFontBytes };

function stripFontExtension(fileName: string): string {
  const separator = fileName.lastIndexOf('.');
  return separator > 0 ? fileName.slice(0, separator) : fileName;
}
