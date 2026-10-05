import { ClipOp, Skia, type SkFont, type SkPicture } from '@shopify/react-native-skia';
import type { ReaderPageContent } from '../anime/core/page-turn-types';
import { renderSkiaOverlays, type ReaderOverlayRect } from './reader-overlays';
import { renderReaderBookmarkMark } from './reader-bookmark-mark';

interface PageCurlPictureOptions {
  readonly layer?: 'all' | 'page' | 'chrome';
  readonly base: SkPicture;
  readonly frame: ReaderPageContent['frame'];
  readonly bookmarked?: boolean;
  readonly bookmarkColor: string;
  readonly color: string;
  readonly height: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly overlayInsets: Readonly<{ top: number; right: number; bottom: number; left: number }>;
  readonly overlays?: readonly ReaderOverlayRect[];
  readonly pageScale: number;
  readonly progress: string;
  readonly progressFont?: SkFont;
  readonly title?: string;
  readonly titleFont?: SkFont;
  readonly viewportHeight: number;
  readonly viewportWidth: number;
  readonly width: number;
}

export function composePageCurlPicture(options: PageCurlPictureOptions): SkPicture {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, options.width, options.height));
  if (options.layer !== 'chrome') {
    canvas.drawPicture(options.base);
    renderSkiaOverlays(canvas, options.overlays ?? []);
  }
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color(options.color));

  const chapterX = (options.overlayInsets.left + 18 - options.offsetX) / options.pageScale;
  const chapterY = (options.overlayInsets.top + 16 - options.offsetY) / options.pageScale;
  const chapterClipWidth = Math.max(
    0,
    (options.viewportWidth - options.overlayInsets.right - 18 - options.offsetX) / options.pageScale - chapterX,
  );
  if (options.layer !== 'page' && options.title && options.titleFont && chapterClipWidth > 0) {
    canvas.save();
    canvas.clipRect(
      Skia.XYWHRect(
        chapterX,
        (options.overlayInsets.top - options.offsetY) / options.pageScale,
        chapterClipWidth,
        24 / options.pageScale,
      ),
      ClipOp.Intersect,
      true,
    );
    canvas.drawText(options.title, chapterX, chapterY, paint, options.titleFont);
    canvas.restore();
  }

  if (options.layer !== 'page' && options.progress && options.progressFont && options.width > 0 && options.height > 0) {
    const progressWidth = options.progressFont.getTextWidth(options.progress);
    const progressX = Math.max(
      chapterX,
      (options.viewportWidth - options.overlayInsets.right - 18 - progressWidth * options.pageScale - options.offsetX) /
        options.pageScale,
    );
    const progressY =
      (Math.max(options.overlayInsets.top + 12, options.viewportHeight - options.overlayInsets.bottom - 12) -
        options.offsetY) /
      options.pageScale;
    canvas.drawText(options.progress, progressX, progressY, paint, options.progressFont);
  }
  if (options.layer !== 'chrome' && options.bookmarked) {
    renderReaderBookmarkMark(
      canvas,
      options.frame,
      options.pageScale,
      options.offsetX,
      options.offsetY,
      options.overlayInsets.top,
      options.bookmarkColor,
    );
  }
  paint.dispose();
  const picture = recorder.finishRecordingAsPicture();
  recorder.dispose();
  return picture;
}

interface NativeViewportPictureOptions {
  readonly pagePicture: SkPicture;
  readonly paperColor: string;
  readonly pageScale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly textureScale: number;
}

export function recordNativeViewportPicture(options: NativeViewportPictureOptions): SkPicture {
  const recorder = Skia.PictureRecorder();
  try {
    const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, options.pixelWidth, options.pixelHeight));
    // Transparent chrome is replayed over the moving pages by the composer.
    // A recorded clear would erase those pages when the picture is replayed.
    if (options.paperColor !== 'transparent') canvas.clear(Skia.Color(options.paperColor));
    canvas.scale(options.textureScale, options.textureScale);
    canvas.translate(options.offsetX, options.offsetY);
    canvas.scale(options.pageScale, options.pageScale);
    canvas.drawPicture(options.pagePicture);
    return recorder.finishRecordingAsPicture();
  } finally {
    recorder.dispose();
  }
}
