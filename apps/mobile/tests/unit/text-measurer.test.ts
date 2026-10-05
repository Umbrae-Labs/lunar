import { describe, expect, it, vi } from 'vitest';
import type { ReaderMeasurePaint } from '../../src/reader/contracts';
import type { LunarSkiaFontRegistry } from '../../src/reader/skia/fonts/font-registry';
import {
  LunarSkiaTextMeasurer,
  type SkiaParagraphFactory,
} from '../../src/reader/skia/text';

vi.mock('@shopify/react-native-skia', () => ({
  FontSlant: { Italic: 1, Upright: 0 },
  FontWidth: { Normal: 5 },
  Skia: {},
}));

const paint: ReaderMeasurePaint = {
  font: {
    family: 'serif',
    weight: 400,
    style: 'normal',
    sizePx: 18,
  },
};

describe('LunarSkiaTextMeasurer', () => {
  it('uses the resolved SkFont for runs without custom spacing', () => {
    const font = {
      getGlyphIDs: vi.fn((text: string) => Array.from(text).map((_, index) => index + 1)),
      getGlyphWidths: vi.fn((glyphs: number[]) => glyphs.map(() => 9)),
      getMetrics: vi.fn(),
    };
    const paragraphs = createParagraphFactory();
    const measurer = createMeasurer(font, paragraphs);

    expect(measurer.measureText('日本語', paint)).toEqual({ width: 27, height: 18 });
    expect(font.getGlyphIDs).toHaveBeenCalledWith('日本語');
    expect(font.getGlyphWidths).toHaveBeenCalledWith([1, 2, 3]);
    expect(paragraphs.measureShapedText).not.toHaveBeenCalled();
  });

  it('reuses an exact text measurement without mutating the paragraph factory', () => {
    const font = {
      getGlyphIDs: vi.fn(() => [1]),
      getGlyphWidths: vi.fn(() => [54]),
      getMetrics: vi.fn(),
    };
    const measurer = createMeasurer(font, createParagraphFactory());

    measurer.measureText('同じ本文', paint);
    measurer.measureText('同じ本文', paint);

    expect(font.getGlyphWidths).toHaveBeenCalledTimes(1);
  });

  it('adds custom character spacing without creating a Paragraph', () => {
    const font = {
      getGlyphIDs: vi.fn(() => [1]),
      getGlyphWidths: vi.fn(() => [54]),
      getMetrics: vi.fn(),
    };
    const paragraphs = createParagraphFactory();
    const measurer = createMeasurer(font, paragraphs);

    expect(measurer.measureText('間隔付き', { ...paint, letterSpacingPx: 1 })).toEqual({
      width: 57,
      height: 18,
    });
    expect(font.getGlyphWidths).toHaveBeenCalledWith([1]);
    expect(paragraphs.measureShapedText).not.toHaveBeenCalled();
  });

  it('uses the bundled SkFont when the source family lacks a glyph', () => {
    const font = {
      getGlyphIDs: vi.fn(() => [1, 0, 1]),
      getGlyphWidths: vi.fn(() => [12, 12, 12]),
      getMetrics: vi.fn(),
    };
    const paragraphs = createParagraphFactory();
    const measurer = createMeasurer(font, paragraphs);

    expect(measurer.measureText('中文文', paint)).toEqual({ width: 36, height: 18 });
    expect(font.getGlyphWidths).toHaveBeenCalledWith([1, 0, 1]);
    expect(paragraphs.measureShapedText).not.toHaveBeenCalled();
  });
});

function createMeasurer(
  font: {
    getGlyphIDs(text: string): number[];
    getGlyphWidths(glyphs: number[]): number[];
    getMetrics(): unknown;
  },
  paragraphs: SkiaParagraphFactory,
): LunarSkiaTextMeasurer {
  const resolver = {
    resolveFont: vi.fn(() => font),
  } as unknown as LunarSkiaFontRegistry;
  return new LunarSkiaTextMeasurer(resolver, paragraphs);
}

function createParagraphFactory(metrics = { width: 0, height: 0 }): SkiaParagraphFactory {
  return {
    createParagraph: vi.fn(),
    measureShapedText: vi.fn(() => metrics),
  } as unknown as SkiaParagraphFactory;
}
