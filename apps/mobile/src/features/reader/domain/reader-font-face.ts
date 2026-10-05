import {
  LUNAR_READER_BUILTIN_FONT_REF,
  type ReaderFontFace,
  type ReaderFontFaces,
  type ReaderFontRef,
  type ReaderFontRole,
  type ReaderTypography,
} from '@/reader';
import type { ImportedReaderFont } from '@/stores/font-store';

/** Reads a managed font's bytes; `undefined` when the file is gone. */
export type ReaderFontByteLoader = (uri: string) => Promise<Uint8Array | undefined>;

const FONT_ROLES: readonly ReaderFontRole[] = ['body', 'chrome'];

/**
 * Turns a persisted font choice into a face the kernel can register.
 *
 * Every unresolvable path lands on the bundled face rather than throwing: a
 * font file can disappear between sessions, and a reader that refuses to open a
 * book because its saved font is missing would be worse than one that quietly
 * reads in the default face.
 *
 * The bundled and system faces carry no bytes. The kernel loads the bundled
 * asset itself, and system faces are resolved through the platform font manager,
 * which is the only thing that can reach them.
 */
export async function resolveReaderFontFace(
  ref: ReaderFontRef,
  catalog: readonly ImportedReaderFont[],
  loadBytes: ReaderFontByteLoader,
): Promise<ReaderFontFace> {
  if (ref.source === 'system') {
    return { family: ref.family, source: 'system' };
  }
  if (ref.source !== 'imported') {
    return { family: ref.family, source: 'builtin' };
  }
  const entry = catalog.find((font) => font.id === ref.importedFontId);
  if (!entry) {
    return { family: LUNAR_READER_BUILTIN_FONT_REF.family, source: 'builtin' };
  }
  const bytes = await loadBytes(entry.uri);
  if (!bytes || bytes.byteLength === 0) {
    return { family: LUNAR_READER_BUILTIN_FONT_REF.family, source: 'builtin' };
  }
  // The catalog id is the file's SHA-256, so the digest Rito verifies against
  // never has to be recomputed over the font bytes.
  return { family: ref.family, source: 'imported', bytes, sha256: entry.id };
}

export async function resolveReaderFontFaces(
  typography: ReaderTypography,
  catalog: readonly ImportedReaderFont[],
  loadBytes: ReaderFontByteLoader,
): Promise<ReaderFontFaces> {
  const [body, chrome] = await Promise.all([
    resolveReaderFontFace(typography.fonts.body, catalog, loadBytes),
    resolveReaderFontFace(typography.fonts.chrome, catalog, loadBytes),
  ]);
  return { body, chrome };
}

/**
 * Rewrites choices that point at a font the catalog no longer has, so deleting
 * a font cannot leave a dangling reference behind. Returns `undefined` when the
 * typography is already resolvable.
 */
export function repairDanglingReaderFonts(
  typography: ReaderTypography,
  catalog: readonly ImportedReaderFont[],
): ReaderTypography | undefined {
  const known = new Set(catalog.map((font) => font.id));
  let repaired = typography;
  for (const role of FONT_ROLES) {
    const ref = typography.fonts[role];
    if (ref.source !== 'imported' || known.has(ref.importedFontId ?? '')) {
      continue;
    }
    repaired = { ...repaired, fonts: { ...repaired.fonts, [role]: LUNAR_READER_BUILTIN_FONT_REF } };
  }
  return repaired === typography ? undefined : repaired;
}
