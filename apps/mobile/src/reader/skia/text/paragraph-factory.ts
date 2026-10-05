import {
  FontSlant,
  FontWidth,
  Skia,
  TextAlign,
  TextDirection,
  type SkParagraph,
  type SkTextStyle,
} from '@shopify/react-native-skia';

import type { ReaderMeasurePaint, ReaderColor, ReaderTextMetrics, ReaderTextShadow } from '../../contracts';
import type { SkiaFontRegistry } from '../fonts/font-registry';
import { skiaColor } from '../rendering/reader-colors';

export interface SkiaParagraphCreateOptions {
  readonly color?: ReaderColor | string;
  readonly alpha?: number;
  readonly textShadow?: readonly ReaderTextShadow[];
  readonly lineHeightPx?: number;
}

export interface SkiaParagraphFactory {
  readonly fonts: SkiaFontRegistry;
  createParagraph(text: string, paint: ReaderMeasurePaint, options?: SkiaParagraphCreateOptions): SkParagraph;
  measureShapedText(text: string, paint: ReaderMeasurePaint): ReaderTextMetrics;
}

export class LunarSkiaParagraphFactory implements SkiaParagraphFactory {
  constructor(readonly fonts: SkiaFontRegistry) {}

  createParagraph(text: string, paint: ReaderMeasurePaint, options: SkiaParagraphCreateOptions = {}): SkParagraph {
    const families = this.fonts.getFontFamilies(paint.font.family);
    const provider = this.fonts.getParagraphProvider(paint.font.family);
    const paragraphStyle = {
      textAlign: TextAlign.Start,
      textDirection: detectParagraphDirection(text) === 'rtl' ? TextDirection.RTL : TextDirection.LTR,
    };
    const builder = provider
      ? Skia.ParagraphBuilder.Make(paragraphStyle, provider)
      : Skia.ParagraphBuilder.Make(paragraphStyle);
    const style: SkTextStyle = {
      color: colorWithAlpha(options.color ?? '#000000', options.alpha ?? 1),
      fontFamilies: families.length > 0 ? [...families] : ['sans-serif'],
      fontSize: paint.font.sizePx,
      ...(options.lineHeightPx && options.lineHeightPx > 0
        ? { heightMultiplier: options.lineHeightPx / paint.font.sizePx }
        : {}),
      fontStyle: {
        weight: Math.max(100, Math.min(900, Math.round(paint.font.weight))),
        width: FontWidth.Normal,
        slant: paint.font.style === 'italic' ? FontSlant.Italic : FontSlant.Upright,
      },
      letterSpacing: paint.letterSpacingPx ?? 0,
      wordSpacing: paint.wordSpacingPx ?? 0,
      locale: 'zh-Hans',
      ...(options.textShadow
        ? {
            shadows: options.textShadow.map((shadow) => ({
              color: colorWithAlpha(shadow.color, options.alpha ?? 1),
              offset: { x: shadow.offsetX, y: shadow.offsetY },
              blurRadius: shadow.blur,
            })),
          }
        : {}),
    };

    try {
      builder.pushStyle(style).addText(text).pop();
      return builder.build();
    } finally {
      builder.reset();
    }
  }

  measureShapedText(text: string, paint: ReaderMeasurePaint): ReaderTextMetrics {
    const paragraph = this.createParagraph(text, paint);
    try {
      paragraph.layout(SINGLE_LINE_LAYOUT_WIDTH);
      return {
        width: paragraph.getLongestLine(),
        height: paragraph.getHeight(),
      };
    } finally {
      paragraph.dispose();
    }
  }
}

export const SINGLE_LINE_LAYOUT_WIDTH = 100_000;

function colorWithAlpha(value: ReaderColor | string, alpha: number) {
  const color = skiaColor(value);
  const resolved = new Float32Array(color);
  resolved[3] = (resolved[3] ?? 1) * Math.min(1, Math.max(0, alpha));
  return resolved;
}

export function detectParagraphDirection(text: string): 'ltr' | 'rtl' {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if ((code >= 0x0590 && code <= 0x08ff) || (code >= 0xfb1d && code <= 0xfdff) || (code >= 0xfe70 && code <= 0xfeff))
      return 'rtl';
    if (
      (code >= 0x0041 && code <= 0x005a) ||
      (code >= 0x0061 && code <= 0x007a) ||
      (code >= 0x00c0 && code <= 0x02af) ||
      (code >= 0x3040 && code <= 0x9fff)
    )
      return 'ltr';
  }
  return 'ltr';
}
