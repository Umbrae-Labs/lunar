import { describe, expect, it, vi } from 'vitest';

import {
  repairDanglingReaderFonts,
  resolveReaderFontFace,
  resolveReaderFontFaces,
} from '../../src/features/reader/domain/reader-font-face';
import {
  LUNAR_READER_BUILTIN_FONT_REF,
  type ReaderFontRef,
  type ReaderTypography,
} from '../../src/reader';

const CATALOG = [
  {
    id: 'sha-one',
    family: 'Source Han Serif',
    fileName: 'SourceHanSerif.ttf',
    uri: 'file:///fonts/sha-one/font.ttf',
    byteLength: 2048,
    style: 'normal' as const,
    weight: 400,
    addedAt: 1,
  },
];

const BYTES = new Uint8Array([1, 2, 3]);

describe('reader font resolution', () => {
  it('resolves an imported face to its bytes and digest', async () => {
    const face = await resolveReaderFontFace(
      { source: 'imported', family: 'Source Han Serif', importedFontId: 'sha-one' },
      CATALOG,
      async () => BYTES,
    );

    expect(face).toEqual({
      family: 'Source Han Serif',
      source: 'imported',
      bytes: BYTES,
      // The catalog id is the file's digest, so Rito's expected_sha256 never has
      // to be recomputed over tens of megabytes of font.
      sha256: 'sha-one',
    });
  });

  it('resolves the bundled and system faces without bytes', async () => {
    const loadBytes = vi.fn(async () => BYTES);

    expect(await resolveReaderFontFace(LUNAR_READER_BUILTIN_FONT_REF, CATALOG, loadBytes)).toEqual({
      family: 'LunarWenKai',
      source: 'builtin',
    });
    expect(
      await resolveReaderFontFace({ source: 'system', family: 'Noto Sans' }, CATALOG, loadBytes),
    ).toEqual({ family: 'Noto Sans', source: 'system' });
    expect(loadBytes).not.toHaveBeenCalled();
  });

  // A book that refuses to open because a saved font went missing would be worse
  // than one that quietly reads in the bundled face.
  it('falls back to the bundled face when the referenced font is gone', async () => {
    const missingEntry = { source: 'imported' as const, family: 'Gone', importedFontId: 'nope' };
    const goneFile = { source: 'imported' as const, family: 'Gone', importedFontId: 'sha-one' };

    expect(await resolveReaderFontFace(missingEntry, CATALOG, async () => BYTES)).toEqual({
      family: LUNAR_READER_BUILTIN_FONT_REF.family,
      source: 'builtin',
    });
    expect(await resolveReaderFontFace(goneFile, CATALOG, async () => undefined)).toEqual({
      family: LUNAR_READER_BUILTIN_FONT_REF.family,
      source: 'builtin',
    });
  });

  it('resolves both roles in one pass', async () => {
    const faces = await resolveReaderFontFaces(
      typography({
        body: { source: 'imported', family: 'Source Han Serif', importedFontId: 'sha-one' },
        chrome: { source: 'system', family: 'Noto Sans' },
      }),
      CATALOG,
      async () => BYTES,
    );

    expect(faces.body.source).toBe('imported');
    expect(faces.chrome).toEqual({ family: 'Noto Sans', source: 'system' });
  });
});

describe('dangling reader font repair', () => {
  it('leaves a resolvable typography untouched', () => {
    const resolvable = typography({
      body: { source: 'imported', family: 'Source Han Serif', importedFontId: 'sha-one' },
      chrome: { source: 'system', family: 'Noto Sans' },
    });

    expect(repairDanglingReaderFonts(resolvable, CATALOG)).toBeUndefined();
  });

  it('repoints only the role whose font is gone', () => {
    const repaired = repairDanglingReaderFonts(
      typography({
        body: { source: 'imported', family: 'Source Han Serif', importedFontId: 'sha-one' },
        chrome: { source: 'imported', family: 'Deleted', importedFontId: 'gone' },
      }),
      CATALOG,
    );

    expect(repaired?.fonts.chrome).toEqual(LUNAR_READER_BUILTIN_FONT_REF);
    expect(repaired?.fonts.body).toEqual({
      source: 'imported',
      family: 'Source Han Serif',
      importedFontId: 'sha-one',
    });
  });

  it('repoints both roles when neither font is left', () => {
    const repaired = repairDanglingReaderFonts(
      typography({
        body: { source: 'imported', family: 'One', importedFontId: 'one' },
        chrome: { source: 'imported', family: 'Two', importedFontId: 'two' },
      }),
      [],
    );

    expect(repaired?.fonts).toEqual({
      body: LUNAR_READER_BUILTIN_FONT_REF,
      chrome: LUNAR_READER_BUILTIN_FONT_REF,
    });
  });
});

function typography(fonts: Record<'body' | 'chrome', ReaderFontRef>): ReaderTypography {
  return {
    fonts,
    fontSize: 18,
    lineHeight: 1.65,
    marginHorizontal: 24,
    marginVertical: 36,
    spreadMode: 'single',
  };
}
