import { Skia, TileMode, type SkCanvas } from '@shopify/react-native-skia';
import type { PosterPage } from '../domain/poster';

/** Cover-derived atmosphere for the exported poster.
 * Decode only three covers, sequentially. Blur a tiny surface, not the export bitmap.
 * The final PNG remains opaque; translucency belongs to this background layer. */
export async function drawAmbientBackground(canvas: SkCanvas, page: PosterPage, signal: { aborted: boolean }) {
  const covers = [...page.tiles]
    .filter(({ book }) => book.coverUri)
    .sort((a, b) => b.book.milliseconds - a.book.milliseconds || a.book.id.localeCompare(b.book.id))
    .slice(0, 3);
  if (!covers.length) return;
  const width = 128,
    height = 172;
  const surface = Skia.Surface.Make(width, height);
  if (!surface) return;
  const target = surface.getCanvas();
  const paint = Skia.Paint();
  const blur = Skia.ImageFilter.MakeBlur(22, 22, TileMode.Clamp, null);
  try {
    target.clear(Skia.Color('#000000'));
    paint.setAntiAlias(true);
    // The leading cover sets the cool/warm base. Other two spill in from opposite
    // edges, leaving no sharp rectangles or readable cover lettering behind.
    const frames = [
      [-32, -32, 192, 236],
      [-55, -14, 140, 192],
      [77, 53, 126, 196],
    ];
    for (let i = 0; i < covers.length; i++) {
      if (signal.aborted) throw Error('Poster cancelled');
      const data = await Skia.Data.fromURI(covers[i].book.coverUri!);
      try {
        const image = Skia.Image.MakeImageFromEncoded(data);
        if (!image) continue;
        try {
          const [x, y, w, h] = frames[i];
          const fit = Math.max(w / image.width(), h / image.height());
          const sw = w / fit,
            sh = h / fit;
          paint.setColor(Skia.Color('#ffffff'));
          target.drawImageRectCubic(
            image,
            Skia.XYWHRect((image.width() - sw) / 2, (image.height() - sh) / 2, sw, sh),
            Skia.XYWHRect(x, y, w, h),
            1 / 3,
            1 / 3,
            paint,
          );
        } finally {
          image.dispose();
        }
      } finally {
        data.dispose();
      }
    }
    paint.setImageFilter(null);
    surface.flush();
    const raw = surface.makeImageSnapshot();
    const softened = Skia.Surface.Make(width, height);
    if (!softened) {
      raw.dispose();
      return;
    }
    let image;
    try {
      paint.setImageFilter(blur);
      softened.getCanvas().drawImage(raw, 0, 0, paint);
      softened.flush();
      image = softened.makeImageSnapshot();
      paint.setImageFilter(null);
      paint.setAlphaf(0.16);
      canvas.drawImageRectCubic(
        image,
        Skia.XYWHRect(0, 0, width, height),
        Skia.XYWHRect(0, 0, page.width, page.height),
        1 / 3,
        1 / 3,
        paint,
      );
    } finally {
      image?.dispose();
      raw.dispose();
      softened.dispose();
    }
    // Quiet title/footer, richer ambient colour beside the covers.
    const shade = Skia.Shader.MakeLinearGradient(
      { x: 0, y: 0 },
      { x: 0, y: page.height },
      ['#00000088', '#00000000', '#00000000', '#00000099'].map(Skia.Color),
      [0, 0.25, 0.76, 1],
      TileMode.Clamp,
    );
    try {
      paint.setAlphaf(1);
      paint.setShader(shade);
      canvas.drawRect(Skia.XYWHRect(0, 0, page.width, page.height), paint);
    } finally {
      paint.setShader(null);
      shade.dispose();
    }
  } finally {
    paint.dispose();
    blur.dispose?.();
    surface.dispose();
  }
}
