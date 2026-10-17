import { expect, it, vi } from 'vitest';
import type { SkTypeface } from '@shopify/react-native-skia';
import { renderPoster } from '../../src/features/statistics/infrastructure/poster-renderer';
import { buildPoster, type PosterLabels } from '../../src/features/statistics/domain/poster';
const state = vi.hoisted(() => ({
  live: 0,
  maxLive: 0,
  drawn: 0,
  decoded: 0,
  snapshots: 0,
  surfaceDisposed: 0,
  failAt: -1,
  brand: false,
  brands: 0,
  texts: [] as string[],
}));
vi.mock('../../src/features/statistics/infrastructure/poster-brand', () => ({
  loadPosterBrand: async () => (state.brand ? { brand: true } : null),
}));
vi.mock('expo-asset', () => ({ Asset: { fromModule: vi.fn() } }));
vi.mock('@shopify/react-native-skia', () => {
  const noop = () => {};
  const paint = () => ({
    setAntiAlias: noop,
    setShader: noop,
    setColor: noop,
    setStrokeWidth: noop,
    setColorFilter: noop,
    dispose: noop,
  });
  const canvas = {
    scale: noop,
    save: noop,
    clipRect: noop,
    restore: noop,
    clear: noop,
    drawRect: noop,
    drawLine: noop,
    drawCircle: noop,
    drawText: (value: string) => state.texts.push(value),
    drawImageRectCubic: (image: { brand?: boolean }) => {
      if (image.brand) {
        state.brands++;
        return;
      }
      state.drawn++;
    },
  };
  return {
    BlendMode: { SrcIn: 1 },
    TileMode: { Clamp: 0 },
    ClipOp: { Intersect: 0 },
    Skia: {
      Color: (s: string) => s,
      XYWHRect: noop,
      Paint: paint,
      Font: () => ({ setSize: noop, getGlyphIDs: () => [], getGlyphWidths: () => [], dispose: noop }),
      ColorFilter: { MakeBlend: () => ({ dispose: noop }) },
      Shader: { MakeLinearGradient: () => ({ dispose: noop }) },
      Data: { fromURI: async () => ({ dispose: noop }) },
      Image: {
        MakeImageFromEncoded: () => {
          state.decoded++;
          if (state.decoded === state.failAt) return null;
          state.live++;
          state.maxLive = Math.max(state.maxLive, state.live);
          return {
            width: () => 400,
            height: () => 600,
            dispose: () => {
              state.live--;
            },
          };
        },
      },
      Surface: {
        Make: () => ({
          getCanvas: () => canvas,
          flush: noop,
          dispose: () => {
            state.surfaceDisposed++;
          },
          makeImageSnapshot: () => {
            state.snapshots++;
            expect(state.live).toBe(0);
            return { encodeToBase64: () => 'PNG', dispose: noop };
          },
        }),
      },
    },
  };
});
const source = Array.from({ length: 120 }, (_, i) => ({
  id: String(i),
  title: `书 ${i}`,
  author: '作者',
  coverUri: `file:///${i}.png`,
  milliseconds: 60000,
}));
const labels: PosterLabels = {
  title: '年记',
  quote: '书页',
  range: '2025-01-01 — 2025-12-31',
  total: '120 本',
  unknownAuthor: '佚名',
  page: '1 / 1',
};
it('draws all 120 real covers sequentially before encoding, without an evictable image cache', async () => {
  Object.assign(state, { live: 0, maxLive: 0, drawn: 0, decoded: 0, snapshots: 0, surfaceDisposed: 0, failAt: -1 });
  const page = buildPoster(source, 1, 'long').pages[0];
  expect(page.tiles).toHaveLength(120);
  expect(await renderPoster(page, labels, { aborted: false }, {} as SkTypeface)).toBe('PNG');
  expect(state).toMatchObject({ drawn: 120, decoded: 120, maxLive: 1, live: 0, snapshots: 1, surfaceDisposed: 1 });
});
it('fails visibly instead of encoding a silently missing cover and releases the raster surface', async () => {
  Object.assign(state, { live: 0, maxLive: 0, drawn: 0, decoded: 0, snapshots: 0, surfaceDisposed: 0, failAt: 3 });
  await expect(
    renderPoster(buildPoster(source, 1, 'long').pages[0], labels, { aborted: false }, {} as SkTypeface),
  ).rejects.toThrow('Cover decode failed');
  expect(state).toMatchObject({ drawn: 2, live: 0, snapshots: 0, surfaceDisposed: 1 });
});

it('uses one restrained brand signature without template labels or decorative prose', async () => {
  Object.assign(state, {
    live: 0,
    maxLive: 0,
    drawn: 0,
    decoded: 0,
    snapshots: 0,
    surfaceDisposed: 0,
    failAt: -1,
    brand: true,
    brands: 0,
    texts: [],
  });
  await renderPoster(
    buildPoster(source.slice(0, 6), 1, 'single').pages[0],
    { ...labels, page: '' },
    { aborted: false },
    {} as SkTypeface,
  );
  expect(state.brands).toBe(1);
  expect(state.texts).toContain('Lunar');
  expect(state.texts.some((t) => /READING MOSAIC|阅读切片|翻过的页|慢慢成为风景|1 \/ 1/.test(t))).toBe(false);
  state.brand = false;
});
