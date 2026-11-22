import type { SkCanvas } from '@shopify/react-native-skia';

import type { ReaderColor, ReaderResolvedRect, ReaderResolvedTextPrimitive } from '../../contracts';
import { SINGLE_LINE_LAYOUT_WIDTH } from '../text/paragraph-factory';
import type { ReaderParagraphCache } from '../text/paragraph-cache';
import type { ReaderPrimitiveRenderOptions } from './primitive-renderer';
import { effectiveTextColor, resolvedPrimitiveColor } from './reader-colors';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function renderResolvedPrimitiveText(
  canvas: SkCanvas,
  command: ReaderResolvedTextPrimitive,
  ratio: number,
  options: ReaderPrimitiveRenderOptions,
  alpha: number,
  paragraphs: ReaderParagraphCache,
  pageGround?: ReaderColor,
  blockGrounds: readonly { rect: ReaderResolvedRect; color: ReaderColor }[] = [],
): void {
  const paint = {
    font: command.paint.font,
    textShadow: command.paint.textShadows.map((shadow) => ({ ...shadow, color: resolvedPrimitiveColor(shadow.color) })),
  };
  const ground =
    [...blockGrounds].reverse().find((entry) => contains(entry.rect, command.rect, ratio))?.color ?? pageGround;
  const ink = effectiveTextColor(resolvedPrimitiveColor(command.paint.color), options.colorOverride, ground);
  const bytes = encoder.encode(command.text);
  // Each cluster is painted as its own cached paragraph at its own origin:
  // repeated CJK clusters hit the cache, which a string joined across
  // `joins` would not. A run without clusters is placed here as one string.
  const { bytes: starts, origins } = command.clusters;
  const placed = starts.length > 0;
  const count = placed ? starts.length : 1;
  const styleKey = JSON.stringify([paint.font, ink, alpha, paint.textShadow, command.lineHeightPx]);
  canvas.save();
  canvas.scale(ratio, ratio);
  try {
    for (let index = 0; index < count; index += 1) {
      const start = placed ? starts[index]! : 0;
      const end = index + 1 < count ? starts[index + 1]! : bytes.length;
      const x = placed ? origins[index * 2]! : command.rect.x;
      const y = placed ? origins[index * 2 + 1]! : command.rect.y + command.paint.font.sizePx * 0.8;
      const text = decoder.decode(bytes.subarray(start, end));
      if (!text) continue;
      const key = JSON.stringify([styleKey, text]);
      const { paragraph, baseline } = paragraphs.getOrCreate(
        key,
        () => {
          const startedAt = options.paragraphMetrics ? performance.now() : undefined;
          const created = options.paragraphs.createParagraph(text, paint, {
            color: ink,
            alpha,
            textShadow: paint.textShadow,
            lineHeightPx: command.lineHeightPx,
          });
          try {
            created.layout(SINGLE_LINE_LAYOUT_WIDTH);
            return {
              paragraph: created,
              baseline: created.getLineMetrics()[0]?.baseline ?? command.paint.font.sizePx * 0.8,
            };
          } catch (error) {
            created.dispose();
            throw error;
          } finally {
            if (startedAt !== undefined && options.paragraphMetrics) {
              options.paragraphMetrics.shapeMs += performance.now() - startedAt;
            }
          }
        },
        options.paragraphMetrics,
      );
      paragraph.paint(canvas, x, y - baseline);
    }
  } finally {
    canvas.restore();
  }
}

function contains(outer: ReaderResolvedRect, inner: ReaderResolvedRect, ratio: number): boolean {
  return (
    inner.x * ratio >= outer.x &&
    inner.y * ratio >= outer.y &&
    (inner.x + inner.width) * ratio <= outer.x + outer.width &&
    (inner.y + inner.height) * ratio <= outer.y + outer.height
  );
}
