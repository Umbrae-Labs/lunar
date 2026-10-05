import { beforeEach, describe, expect, it, vi } from 'vitest';
import { composePageCurlPicture, recordNativeViewportPicture } from '../../src/reader/skia/rendering/page-picture';

const state = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock('@shopify/react-native-skia', () => ({
  ClipOp: { Intersect: 0 },
  Skia: {
    Color: (value: string) => value,
    XYWHRect: (...values: number[]) => values,
    Paint: () => ({ setAntiAlias() {}, setColor() {}, dispose() {} }),
    PictureRecorder: () => ({
      beginRecording: () => ({
        drawPicture: (picture: unknown) => state.calls.push(['page', picture]),
        drawText: (text: string) => state.calls.push(['text', text]),
        clear: (color: string) => state.calls.push(['clear', color]),
        scale() {}, translate() {}, save() {}, restore() {}, clipRect() {},
      }),
      finishRecordingAsPicture: () => ({}), dispose() {},
    }),
  },
}));
vi.mock('../../src/reader/skia/rendering/reader-overlays', () => ({
  renderSkiaOverlays: () => state.calls.push(['overlays']),
}));
vi.mock('../../src/reader/skia/rendering/reader-bookmark-mark', () => ({
  renderReaderBookmarkMark: () => state.calls.push(['bookmark']),
}));
beforeEach(() => { state.calls.length = 0; });

const options = {
  base: {}, frame: { width: 400, height: 800 }, bookmarked: true, bookmarkColor: '#ff0000',
  color: '#000000', height: 800, width: 400, offsetX: 0, offsetY: 0,
  overlayInsets: { top: 24, right: 0, bottom: 24, left: 0 }, pageScale: 1,
  progress: '2 / 10', progressFont: { getTextWidth: () => 36 }, title: 'Chapter', titleFont: {},
  viewportHeight: 800, viewportWidth: 400,
} as unknown as Parameters<typeof composePageCurlPicture>[0];

describe('native page recordings', () => {
  it('records the whole bookmark with moving body content, without header/footer text', () => {
    composePageCurlPicture({ ...options, layer: 'page' });
    expect(state.calls).toEqual([['page', options.base], ['overlays'], ['bookmark']]);
  });
  it('records only fixed header/footer text in the independent chrome layer', () => {
    composePageCurlPicture({ ...options, layer: 'chrome' });
    expect(state.calls).toEqual([['text', 'Chapter'], ['text', '2 / 10']]);
  });
  it('continues recording all page elements together for curl', () => {
    composePageCurlPicture(options);
    expect(state.calls).toEqual([['page', options.base], ['overlays'], ['text', 'Chapter'], ['text', '2 / 10'], ['bookmark']]);
  });
  it('records chrome without an erase operation so it can be replayed over page content', () => {
    const chrome = {} as never;
    recordNativeViewportPicture({ pagePicture: chrome, paperColor: 'transparent',
      pageScale: 1, offsetX: 0, offsetY: 0, pixelWidth: 800, pixelHeight: 1600, textureScale: 2 });
    expect(state.calls).toEqual([['page', chrome]]);
  });
});
