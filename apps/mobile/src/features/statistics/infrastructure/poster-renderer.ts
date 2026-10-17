import { Skia, TileMode, ClipOp, BlendMode, type SkTypeface } from '@shopify/react-native-skia';
import { Asset } from 'expo-asset';
import { loadPosterBrand } from './poster-brand';
import { posterQuoteLayout, wrapPosterText, type PosterLabels, type PosterPage } from '../domain/poster';

let fontPromise: Promise<SkTypeface> | undefined;
export function preparePosterTypeface() {
  return (fontPromise ??= (async () => {
    const asset = Asset.fromModule(require('../../../../assets/fonts/LXGWWenKai-Regular.ttf'));
    await asset.downloadAsync();
    const data = await Skia.Data.fromURI(asset.localUri || asset.uri);
    try {
      const face = Skia.Typeface.MakeFreeTypeFaceFromData(data);
      if (!face) throw Error('Poster font unavailable');
      return face;
    } finally {
      data.dispose();
    }
  })().catch((error) => {
    fontPromise = undefined;
    throw error;
  }));
}

/** CPU raster surface: draw and release each cover before decoding the next one.
 * Never depend on Fresco's evictable SVG cache for a full-year, hundred-cover export. */
export async function renderPoster(
  page: PosterPage,
  labels: PosterLabels,
  signal: { aborted: boolean },
  typeface?: SkTypeface,
) {
  const face = typeface ?? (await preparePosterTypeface());
  const brand = await loadPosterBrand();
  const scale = page.height === 1440 ? 3 : page.height <= 2000 ? 2 : 1;
  const surface = Skia.Surface.Make(page.width * scale, page.height * scale);
  if (!surface) throw Error('Poster bitmap allocation failed');
  const canvas = surface.getCanvas();
  canvas.scale(scale, scale);
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  const font = Skia.Font(face, 20);
  const ink = '#eeeaf2',
    muted = '#a5a0b3',
    accent = '#c5b7d8',
    paper = '#171821';
  const color = (value: string) => {
    paint.setShader(null);
    paint.setColor(Skia.Color(value));
  };
  const rect = (x: number, y: number, w: number, h: number, value: string) => {
    color(value);
    canvas.drawRect(Skia.XYWHRect(x, y, w, h), paint);
  };
  const line = (x: number, y: number, x2: number, y2: number, value = '#44424f') => {
    color(value);
    paint.setStrokeWidth(1);
    canvas.drawLine(x, y, x2, y2, paint);
  };
  const circle = (x: number, y: number, r: number, value: string) => {
    color(value);
    canvas.drawCircle(x, y, r, paint);
  };
  const text = (value: string, x: number, y: number, size: number, valueColor = ink, end = false) => {
    if (!value) return;
    font.setSize(size);
    color(valueColor);
    const offset = end ? font.getGlyphWidths(font.getGlyphIDs(value)).reduce((sum, n) => sum + n, 0) : 0;
    canvas.drawText(value, x - offset, y, paint, font);
  };
  try {
    canvas.clear(Skia.Color(paper));
    line(64, 47, 1016, 47);
    if (labels.page) text(labels.page, 1016, 82, 16, muted, true);
    text(wrapPosterText(labels.title, 20, 1)[0] || '', 64, 147, 44);
    text(labels.range, 64, 190, 19, muted);
    text(labels.total, 1016, 190, 20, muted, true);
    for (const tile of page.tiles) {
      if (signal.aborted) throw Error('Poster cancelled');
      const { book, x, y, width: w, height: h } = tile;
      canvas.save();
      canvas.clipRect(Skia.XYWHRect(x, y, w, h), ClipOp.Intersect, false);
      const tint = ['#284358', '#6e5563', '#587267', '#a48058', '#4a5c73', '#9d9380'][
        Array.from(book.id).reduce((s, c) => s + c.charCodeAt(0), 0) % 6
      ];
      rect(x, y, w, h, tint);
      if (book.coverUri) {
        const data = await Skia.Data.fromURI(book.coverUri);
        try {
          const image = Skia.Image.MakeImageFromEncoded(data);
          if (!image) throw Error('Cover decode failed');
          try {
            // A centered crop preserves the cover's aspect ratio.
            const fit = Math.max(w / image.width(), h / image.height());
            const sw = w / fit,
              sh = h / fit;
            color('#ffffff');
            canvas.drawImageRectCubic(
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
      } else {
        circle(x + w * 0.72, y + h * 0.27, Math.min(w, h) * 0.16, '#9b8ba3');
      }
      rect(x, y, w, h, '#1b15302e');
      color('#ffffff');
      const shade = Skia.Shader.MakeLinearGradient(
        { x, y },
        { x, y: y + h },
        [Skia.Color('#0d0d1700'), Skia.Color('#0d0d1710'), Skia.Color('#0d0d17e8')],
        [0, 0.38, 1],
        TileMode.Clamp,
      );
      try {
        paint.setShader(shade);
        canvas.drawRect(Skia.XYWHRect(x, y, w, h), paint);
      } finally {
        paint.setShader(null);
        shade.dispose();
      }
      const pad = Math.min(18, w * 0.08),
        size = Math.min(42, Math.max(8, Math.min(w / 7, h / 7))),
        authorSize = Math.max(6, Math.min(19, size * 0.6));
      const lines = wrapPosterText(book.title, (w - pad * 2) / size, 2),
        authorY = y + h - Math.min(20, h * 0.07),
        lineHeight = size + Math.min(7, size * 0.2),
        titleY = authorY - authorSize - Math.min(15, h * 0.05) - (lines.length - 1) * lineHeight;
      lines.forEach((value, i) => text(value, x + pad, titleY + i * lineHeight, size));
      text(
        wrapPosterText(book.author || labels.unknownAuthor, (w - pad * 2) / authorSize, 1)[0] || '',
        x + pad,
        authorY,
        authorSize,
        '#d4cddd',
      );
      canvas.restore();
      // Yield between covers so cancellation and progress remain responsive.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const note = posterQuoteLayout(page, labels.quote);
    if (note) {
      const { box, x, top, size, heading, lineHeight, lines } = note;
      canvas.save();
      canvas.clipRect(Skia.XYWHRect(box.x, box.y, box.width, box.height), ClipOp.Intersect, false);
      const radius = size * 0.3;
      circle(x + radius, top + radius, radius, accent);
      circle(x + radius * 1.5, top + radius * 0.65, radius * 0.85, paper);
      line(x + size, top + radius, box.x + box.width - (x - box.x), top + radius);
      lines.forEach((value, i) => text(value, x, top + heading + size + i * lineHeight, size, accent));
      canvas.restore();
    }
    if (brand) {
      color('#ffffff');
      const tint = Skia.ColorFilter.MakeBlend(Skia.Color('#c5b7d8cc'), BlendMode.SrcIn);
      try {
        paint.setColorFilter(tint);
        canvas.drawImageRectCubic(
          brand,
          Skia.XYWHRect(180, 190, 660, 640),
          Skia.XYWHRect(64, page.height - 66, 48, 48),
          1 / 3,
          1 / 3,
          paint,
        );
      } finally {
        paint.setColorFilter(null);
        tint.dispose();
      }
    }
    text('Lunar', 124, page.height - 29, 19, muted);
    if (signal.aborted) throw Error('Poster cancelled');
    surface.flush();
    const image = surface.makeImageSnapshot();
    try {
      return image.encodeToBase64();
    } finally {
      image.dispose();
    }
  } finally {
    font.dispose();
    paint.dispose();
    surface.dispose();
  }
}
