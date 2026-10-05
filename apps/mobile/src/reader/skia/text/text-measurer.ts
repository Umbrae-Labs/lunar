import type {
  ReaderFontMetrics,
  ReaderFontMetricsProvider,
  ReaderMeasurePaint,
  ReaderTextMeasurer,
  ReaderTextMetrics,
} from '../../contracts';
import type { LunarSkiaFontRegistry } from '../fonts/font-registry';
import { LunarSkiaParagraphFactory, type SkiaParagraphFactory } from './paragraph-factory';

export interface SkiaTextMeasurer extends ReaderTextMeasurer, ReaderFontMetricsProvider {
  readonly fontResolver: LunarSkiaFontRegistry;
  readonly paragraphs: SkiaParagraphFactory;
  clearCache(): void;
  dispose(): void;
}

const MAX_TEXT_MEASUREMENTS = 16_384;
const MAX_FONT_METRICS = 256;

export class LunarSkiaTextMeasurer implements SkiaTextMeasurer {
  private readonly textCache = new Map<string, ReaderTextMetrics>();
  private readonly metricsCache = new Map<string, ReaderFontMetrics>();
  private disposed = false;

  constructor(
    readonly fontResolver: LunarSkiaFontRegistry,
    readonly paragraphs: SkiaParagraphFactory = new LunarSkiaParagraphFactory(fontResolver),
  ) {}

  measureText(text: string, paint: ReaderMeasurePaint): ReaderTextMetrics {
    this.assertActive();
    const key = createTextKey(text, paint);
    const cached = this.textCache.get(key);
    if (cached) {
      return cached;
    }

    const metrics = {
      width: this.measureWidth(text, paint),
      height: this.resolveFontMetricsSafe(paint),
    };
    writeBoundedCache(this.textCache, key, metrics, MAX_TEXT_MEASUREMENTS);
    return metrics;
  }

  resolveFontMetrics(paint: ReaderMeasurePaint): ReaderFontMetrics {
    this.assertActive();
    const key = createFontKey(paint);
    const cached = this.metricsCache.get(key);
    if (cached) {
      return cached;
    }

    const metrics = this.fontResolver.resolveFont(paint.font).getMetrics?.() ?? {
      ascent: -paint.font.sizePx * 0.8,
      descent: paint.font.sizePx * 0.2,
      leading: 0,
    };
    const resolved = {
      ascentPx: Math.max(0, -metrics.ascent),
      descentPx: Math.max(0, metrics.descent),
      lineGapPx: Math.max(0, metrics.leading),
      contentHeightPx: Math.max(0, -metrics.ascent) + Math.max(0, metrics.descent) + Math.max(0, metrics.leading),
    };
    writeBoundedCache(this.metricsCache, key, resolved, MAX_FONT_METRICS);
    return resolved;
  }

  clearCache(): void {
    this.textCache.clear();
    this.metricsCache.clear();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearCache();
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error('The Skia text measurer is disposed.');
    }
  }

  private measureWidth(text: string, paint: ReaderMeasurePaint): number {
    const font = this.fontResolver.resolveFont(paint.font);
    const characters = Array.from(text);
    const letterSpacing = paint.letterSpacingPx ?? 0;
    const wordSpacing = paint.wordSpacingPx ?? 0;
    return (
      getTextAdvance(font, text) +
      Math.max(0, characters.length - 1) * letterSpacing +
      characters.filter((character) => character === ' ').length * wordSpacing
    );
  }

  private resolveFontMetricsSafe(paint: ReaderMeasurePaint): number {
    try {
      const metrics = this.resolveFontMetrics(paint);
      return metrics.contentHeightPx || paint.font.sizePx;
    } catch {
      return paint.font.sizePx;
    }
  }
}

function getTextAdvance(font: ReturnType<LunarSkiaFontRegistry['resolveFont']>, text: string): number {
  const glyphs = font.getGlyphIDs(text);
  return font.getGlyphWidths(glyphs).reduce((width, glyphWidth) => width + glyphWidth, 0);
}

function createTextKey(text: string, paint: ReaderMeasurePaint): string {
  return `${createFontKey(paint)}\0${paint.wordSpacingPx ?? 0}\0${paint.letterSpacingPx ?? 0}\0${text}`;
}

function createFontKey(paint: ReaderMeasurePaint): string {
  const { font } = paint;
  return `${font.family}\0${font.weight}\0${font.style}\0${font.sizePx}`;
}

function writeBoundedCache<T>(cache: Map<string, T>, key: string, value: T, limit: number): void {
  cache.set(key, value);
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    cache.delete(oldest);
  }
}
