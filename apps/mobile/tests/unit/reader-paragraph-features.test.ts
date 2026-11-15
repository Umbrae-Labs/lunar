import { describe, expect, it, vi } from 'vitest';

import { LunarSkiaParagraphFactory } from '../../src/reader/skia/text/paragraph-factory';
import type { SkiaFontRegistry } from '../../src/reader/skia/fonts/font-registry';

const built = vi.hoisted(() => ({ styles: [] as Record<string, unknown>[] }));

vi.mock('@shopify/react-native-skia', () => ({
  FontSlant: { Italic: 'italic', Upright: 'upright' },
  FontWidth: { Normal: 'normal' },
  TextAlign: { Start: 'start' },
  TextDirection: { LTR: 'ltr', RTL: 'rtl' },
  Skia: {
    ParagraphBuilder: {
      Make: () => {
        const builder = {
          pushStyle: (style: Record<string, unknown>) => {
            built.styles.push(style);
            return builder;
          },
          addText: () => builder,
          pop: () => builder,
          build: () => ({}),
          reset: () => undefined,
        };
        return builder;
      },
    },
  },
}));

vi.mock('../../src/reader/skia/rendering/reader-colors', () => ({ skiaColor: () => new Float32Array([0, 0, 0, 1]) }));

describe('Skia paragraph factory', () => {
  it('shapes a feature family with its OpenType features and leaves an ordinary face alone', () => {
    const features: Record<string, readonly { tag: string; value: number }[]> = {
      '__RitoVert___RitoPinned_abc': [{ tag: 'vert', value: 1 }],
    };
    const fonts = {
      getFontFamilies: (family: string) => [family, 'Lunar'],
      getParagraphProvider: () => ({}),
      getFontFeatures: (family: string) => features[family] ?? [],
    } as unknown as SkiaFontRegistry;
    const factory = new LunarSkiaParagraphFactory(fonts);
    const paint = (family: string) => ({ font: { family, sizePx: 16, weight: 400, style: 'normal' as const } });

    factory.createParagraph('「縦」', paint('__RitoVert___RitoPinned_abc'));
    factory.createParagraph('横', paint('__RitoPinned_abc'));

    expect(built.styles[0]?.fontFeatures).toEqual([{ name: 'vert', value: 1 }]);
    expect(built.styles[1]).not.toHaveProperty('fontFeatures');
  });
});
