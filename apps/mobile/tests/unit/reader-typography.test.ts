import { describe, expect, it } from 'vitest';

import {
  createReaderTypographyKey,
  LUNAR_READER_BUILTIN_FONT_REF,
  LUNAR_READER_FONT_FAMILY,
  normalizeReaderTypography,
  type ReaderTypography,
} from '../../src/reader';

const typography: ReaderTypography = {
  styleMode: 'custom',
  fonts: {
    body: { source: 'imported', family: 'Source Han Serif', importedFontId: 'abc' },
    chrome: { source: 'system', family: 'Noto Sans' },
  },
  fontSize: 18,
  lineHeight: 1.65,
  marginHorizontal: 24,
  marginVertical: 36,
  spreadMode: 'single',
};

describe('reader typography', () => {
  it('keeps the selected body font and the dimensions it lays out with', () => {
    expect(normalizeReaderTypography(typography)).toEqual(typography);
    expect(createReaderTypographyKey(typography)).toBe(
      '["imported","Source Han Serif","abc",18,1.65,24,36,"single","custom"]',
    );
  });

  it('resolves a legacy flat fontFamily to the bundled face', () => {
    const legacy = {
      fontFamily: 'LunarWenKai',
      fontSize: 18,
      lineHeight: 1.65,
      marginHorizontal: 24,
      marginVertical: 36,
      spreadMode: 'single' as const,
    };

    expect(normalizeReaderTypography(legacy).fonts).toEqual({
      body: LUNAR_READER_BUILTIN_FONT_REF,
      chrome: LUNAR_READER_BUILTIN_FONT_REF,
    });
    expect(normalizeReaderTypography(legacy).styleMode).toBe('custom');
  });

  it('restores publisher mode from persisted settings and gives it a distinct layout', () => {
    const publisher = { ...typography, styleMode: 'publisher' as const };
    expect(normalizeReaderTypography(JSON.parse(JSON.stringify(publisher))).styleMode).toBe('publisher');
    expect(createReaderTypographyKey(publisher)).not.toBe(createReaderTypographyKey(typography));
    expect(createReaderTypographyKey({ ...publisher, lineHeight: 2 })).toBe(createReaderTypographyKey(publisher));
    expect(createReaderTypographyKey({ ...publisher, fontSize: 24 })).not.toBe(createReaderTypographyKey(publisher));
    const { styleMode: _mode, ...oldSettings } = typography;
    expect(createReaderTypographyKey(oldSettings)).toBe(createReaderTypographyKey(typography));
  });

  // Reflow is driven entirely by this key, so a chrome-only change has to leave
  // it byte-identical — otherwise picking a chapter-title font would re-paginate
  // the whole book.
  it('ignores the chrome font but tracks the body font', () => {
    const chromeChanged: ReaderTypography = {
      ...typography,
      fonts: { ...typography.fonts, chrome: { source: 'builtin', family: LUNAR_READER_FONT_FAMILY } },
    };
    const bodyChanged: ReaderTypography = {
      ...typography,
      fonts: {
        ...typography.fonts,
        body: { source: 'imported', family: 'Source Han Serif', importedFontId: 'def' },
      },
    };

    expect(createReaderTypographyKey(chromeChanged)).toBe(createReaderTypographyKey(typography));
    expect(createReaderTypographyKey(bodyChanged)).not.toBe(createReaderTypographyKey(typography));
  });

  it('rejects a body font that carries no bytes to measure with', () => {
    expect(() =>
      normalizeReaderTypography({
        ...typography,
        fonts: { ...typography.fonts, body: { source: 'system', family: 'Noto Sans' } },
      }),
    ).toThrow(/cannot use a system font/);
  });

  it('rejects font references that cannot resolve to a face', () => {
    expect(() =>
      normalizeReaderTypography({
        ...typography,
        fonts: { ...typography.fonts, body: { source: 'imported', family: 'X' } },
      }),
    ).toThrow(/requires an importedFontId/);
    expect(() =>
      normalizeReaderTypography({
        ...typography,
        fonts: { ...typography.fonts, chrome: { source: 'builtin', family: '   ' } },
      }),
    ).toThrow(/family must not be empty/);
    expect(() =>
      normalizeReaderTypography({
        ...typography,
        fonts: { ...typography.fonts, chrome: { source: 'cloud', family: 'X' } },
      }),
    ).toThrow(/not a known font source/);
  });

  it('rejects dimensions that cannot produce a valid layout', () => {
    expect(() =>
      normalizeReaderTypography({ ...typography, fontSize: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      normalizeReaderTypography({ ...typography, marginVertical: -1 }),
    ).toThrow(RangeError);
  });
});
