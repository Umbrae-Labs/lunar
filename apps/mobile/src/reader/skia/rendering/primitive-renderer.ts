import {
  BlurStyle,
  ClipOp,
  FillType,
  PaintStyle,
  Skia,
  StrokeCap,
  type SkCanvas,
  type SkPath,
} from '@shopify/react-native-skia';

import type {
  ReaderColor,
  ReaderResolvedPathOp,
  ReaderResolvedPrimitive,
  ReaderResolvedPrimitiveList,
  ReaderResolvedRect,
} from '../../contracts';
import type { SkiaImageAsset } from '../images/image-decoder';
import type { SkiaParagraphFactory } from '../text/paragraph-factory';
import { ReaderParagraphCache, type ReaderParagraphMetrics } from '../text/paragraph-cache';
import {
  isBookOwnedPageGround,
  isOpaqueColor,
  makeResolvedPrimitivePaint,
  resolvedPrimitiveColor,
  type SkiaColorOverride,
} from './reader-colors';
import { renderResolvedPrimitiveText } from './primitive-text-renderer';

export interface ReaderPrimitiveRenderOptions {
  readonly pixelRatio: number;
  readonly images: { resolveImage(source: string): SkiaImageAsset | undefined };
  readonly paragraphs: SkiaParagraphFactory;
  readonly paragraphCache?: ReaderParagraphCache;
  readonly paragraphMetrics?: ReaderParagraphMetrics;
  readonly colorOverride?: SkiaColorOverride;
}

function safeDispose(resource: unknown): void {
  if (typeof resource === 'object' && resource !== null && 'dispose' in resource) {
    const dispose = (resource as { dispose?: unknown }).dispose;
    if (typeof dispose === 'function') {
      try {
        dispose.call(resource);
      } catch {
        // Ignored
      }
    }
  }
}

export function renderResolvedPrimitives(
  canvas: SkCanvas,
  list: ReaderResolvedPrimitiveList,
  options: ReaderPrimitiveRenderOptions,
): void {
  if (!Number.isFinite(list.ratio) || list.ratio <= 0) throw new Error('Invalid Rito render ratio.');
  let alpha = 1;
  let pageGround: ReaderColor | undefined;
  const alphaStack = [alpha];
  const blockGrounds: { rect: ReaderResolvedRect; color: ReaderColor }[] = [];
  const groundStackSizes: number[] = [];
  const paragraphs = options.paragraphCache ?? new ReaderParagraphCache();
  canvas.save();
  try {
    // Rito resolves geometry in device pixels; the Picture uses the compiler's scale.
    canvas.scale(options.pixelRatio / list.ratio, options.pixelRatio / list.ratio);
    for (const command of list.commands) {
      switch (command.kind) {
        case 'push-state':
          canvas.save();
          alphaStack.push(alpha);
          groundStackSizes.push(blockGrounds.length);
          break;
        case 'pop-state':
          if (alphaStack.length <= 1) throw new Error('Rito primitive state is unbalanced.');
          canvas.restore();
          alphaStack.pop();
          alpha = alphaStack.at(-1)!;
          blockGrounds.length = groundStackSizes.pop()!;
          break;
        case 'translate':
          canvas.translate(command.dx, command.dy);
          break;
        case 'opacity':
          alpha *= command.value;
          alphaStack[alphaStack.length - 1] = alpha;
          break;
        case 'transform':
          canvas.translate(command.origin.x, command.origin.y);
          for (const transform of command.transforms) {
            if (transform.kind === 'rotate') canvas.rotate((transform.radians * 180) / Math.PI, 0, 0);
            else if (transform.kind === 'scale') canvas.scale(transform.sx, transform.sy);
            else canvas.translate(transform.dx, transform.dy);
          }
          canvas.translate(-command.origin.x, -command.origin.y);
          break;
        case 'clip-path': {
          const path = makeResolvedPrimitivePath(command.path);
          canvas.clipPath(path, ClipOp.Intersect, true);
          safeDispose(path);
          break;
        }
        case 'fill-rect':
        case 'fill-path': {
          const original = resolvedPrimitiveColor(command.color);
          const resolved =
            command.ground === 'page' && options.colorOverride && !isBookOwnedPageGround(original)
              ? options.colorOverride.backgroundColor
              : original;
          if (command.ground === 'page') {
            blockGrounds.length = 0;
            pageGround = resolved === original && isOpaqueColor(original) ? original : undefined;
          }
          if (command.ground === 'block' && command.groundRect && isOpaqueColor(original)) {
            blockGrounds.push({ rect: command.groundRect, color: original });
          }
          const paint = makeResolvedPrimitivePaint(resolved, alpha);
          if (command.kind === 'fill-rect') canvas.drawRect(resolvedPrimitiveRect(command.rect), paint);
          else {
            const path = makeResolvedPrimitivePath(command.path, command.rule);
            canvas.drawPath(path, paint);
            safeDispose(path);
          }
          safeDispose(paint);
          break;
        }
        case 'stroke-path': {
          const path = makeResolvedPrimitivePath(command.path);
          const paint = makeResolvedPrimitivePaint(resolvedPrimitiveColor(command.color), alpha);
          paint.setStyle(PaintStyle.Stroke);
          paint.setStrokeWidth(command.width);
          paint.setStrokeCap(command.cap === 'round' ? StrokeCap.Round : StrokeCap.Butt);
          const effect = command.dash ? Skia.PathEffect.MakeDash([command.dash.on, command.dash.off]) : undefined;
          if (effect) paint.setPathEffect(effect);
          canvas.drawPath(path, paint);
          safeDispose(effect);
          safeDispose(paint);
          safeDispose(path);
          break;
        }
        case 'shadow': {
          const path = makeResolvedPrimitivePath(command.shape);
          const paint = makeResolvedPrimitivePaint(resolvedPrimitiveColor(command.color), alpha);
          const filter =
            command.sigma > 0 ? Skia.MaskFilter.MakeBlur(BlurStyle.Normal, command.sigma, true) : undefined;
          if (filter) paint.setMaskFilter(filter);
          canvas.save();
          if (command.clipOut) {
            const clip = makeResolvedPrimitivePath(command.clipOut);
            canvas.clipPath(clip, ClipOp.Difference, true);
            safeDispose(clip);
          }
          canvas.translate(command.offset.x, command.offset.y);
          canvas.drawPath(path, paint);
          canvas.restore();
          safeDispose(filter);
          safeDispose(paint);
          safeDispose(path);
          break;
        }
        case 'draw-image':
          drawImage(canvas, command, options, alpha);
          break;
        case 'text':
        case 'ruby':
          renderResolvedPrimitiveText(
            canvas,
            command,
            list.ratio,
            options,
            alpha,
            paragraphs,
            pageGround,
            blockGrounds,
          );
          break;
        default:
          assertNever(command);
      }
    }
    if (alphaStack.length !== 1) throw new Error('Rito primitive state is unbalanced.');
  } finally {
    while (alphaStack.length > 1) {
      canvas.restore();
      alphaStack.pop();
    }
    canvas.restore();
    if (!options.paragraphCache) paragraphs.clear();
  }
}

function drawImage(
  canvas: SkCanvas,
  command: Extract<ReaderResolvedPrimitive, { kind: 'draw-image' }>,
  options: ReaderPrimitiveRenderOptions,
  alpha: number,
): void {
  const asset = options.images.resolveImage(command.src);
  if (!asset) return;
  const paint = makeResolvedPrimitivePaint('#fff', alpha);
  const source = command.sourceRect ?? { x: 0, y: 0, width: asset.width, height: asset.height };
  if (!command.tiles)
    canvas.drawImageRect(asset.image, resolvedPrimitiveRect(source), resolvedPrimitiveRect(command.dest), paint);
  else {
    const tiles = command.tiles;
    for (let row = 0; row < tiles.rows; row += 1) {
      for (let column = 0; column < tiles.columns; column += 1) {
        canvas.drawImageRect(
          asset.image,
          resolvedPrimitiveRect(source),
          resolvedPrimitiveRect({
            ...command.dest,
            x: tiles.origin.x + column * tiles.stepX,
            y: tiles.origin.y + row * tiles.stepY,
          }),
          paint,
        );
      }
    }
  }
  safeDispose(paint);
}

function resolvedPrimitiveRect(value: ReaderResolvedRect) {
  return Skia.XYWHRect(value.x, value.y, value.width, value.height);
}

export function makeResolvedPrimitivePath(ops: readonly ReaderResolvedPathOp[], rule?: 'nonzero' | 'evenodd'): SkPath {
  const builder = Skia.PathBuilder.Make();
  try {
    if (rule) builder.setFillType(rule === 'evenodd' ? FillType.EvenOdd : FillType.Winding);
    for (const op of ops) {
      switch (op.op) {
        case 'move-to':
          builder.moveTo(op.x, op.y);
          break;
        case 'line-to':
          builder.lineTo(op.x, op.y);
          break;
        case 'arc':
          builder.arcToOval(
            Skia.XYWHRect(op.cx - op.rx, op.cy - op.ry, op.rx * 2, op.ry * 2),
            (op.start * 180) / Math.PI,
            (op.sweep * 180) / Math.PI,
            false,
          );
          break;
        case 'ellipse':
          builder.addOval(Skia.XYWHRect(op.cx - op.rx, op.cy - op.ry, op.rx * 2, op.ry * 2));
          break;
        case 'rect':
          builder.addRect(resolvedPrimitiveRect(op));
          break;
        case 'close':
          builder.close();
          break;
        default:
          assertNever(op);
      }
    }
    return builder.build();
  } finally {
    safeDispose(builder);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown Rito primitive: ${String(value)}`);
}
