import { describe, expect, it, vi } from 'vitest';
import type { SkCanvas, SkParagraph } from '@shopify/react-native-skia';

import type { ReaderDisplayList, ReaderResolvedTextPrimitive } from '../../src/reader/contracts';
import { SkiaPictureCompiler } from '../../src/reader/skia/rendering/picture-compiler';
import type { ReaderPrimitiveRenderOptions } from '../../src/reader/skia/rendering/primitive-renderer';
import { ReaderParagraphCache } from '../../src/reader/skia/text/paragraph-cache';

vi.mock('@shopify/react-native-skia', () => ({
  Skia: {
    XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
    PictureRecorder: () => ({
      beginRecording: () => ({ save() {}, restore() {}, scale() {} }),
      finishRecordingAsPicture: () => ({ dispose() {} }),
      dispose() {},
    }),
  },
}));

function paragraph() {
  return { paragraph: { dispose: vi.fn() } as unknown as SkParagraph, baseline: 8 };
}

function fixture() {
  const fonts = { generation: 1 };
  const created: { layout: ReturnType<typeof vi.fn>; getLineMetrics: ReturnType<typeof vi.fn>;
    paint: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] = [];
  const createParagraph = vi.fn(() => {
    const value = { layout: vi.fn(), getLineMetrics: vi.fn(() => [{ baseline: 8 }]),
      paint: vi.fn(), dispose: vi.fn() };
    created.push(value);
    return value;
  });
  const options = { pixelRatio: 1, images: { resolveImage: () => undefined },
    paragraphs: { fonts, createParagraph } } as unknown as ReaderPrimitiveRenderOptions;
  const command: ReaderResolvedTextPrimitive = {
    kind: 'text', text: '文字文', rect: { x: 10, y: 20, width: 36, height: 14 },
    paint: { font: { family: 'Test', sizePx: 12, weight: 400, style: 'normal' },
      color: { space: 'srgb', component0: 0, component1: 0, component2: 0, alpha: 1,
        none: { component0: false, component1: false, component2: false, alpha: false } }, textShadows: [] },
    clusters: [{ byte: 0, x: 10, y: 20 }, { byte: 3, x: 22, y: 20 }, { byte: 6, x: 34, y: 20 }],
  };
  const display = (value = command) => ({ width: 400, height: 800,
    resolvedPrimitives: { formatVersion: 2, ratio: 1, commandCount: 1, commands: [value] },
  }) as ReaderDisplayList;
  return { options, fonts, created, createParagraph, command, display };
}

describe('paragraph reuse across page recordings', () => {
  it('shapes and queries metrics once per distinct cluster while retaining each paint position', () => {
    const { options, created, createParagraph, display, command } = fixture();
    const compiler = new SkiaPictureCompiler();
    const first = compiler.compile(display(), options);
    const second = compiler.compile(display({ ...command, clusters: command.clusters.map((c) => ({ ...c, y: 40 })) }), options);
    expect(createParagraph).toHaveBeenCalledTimes(2);
    expect(created[0].layout).toHaveBeenCalledTimes(1);
    expect(created[0].getLineMetrics).toHaveBeenCalledTimes(1);
    expect(created[0].paint.mock.calls.map(([, x, y]: [SkCanvas, number, number]) => [x, y]))
      .toEqual([[10, 12], [34, 12], [10, 32], [34, 32]]);
    compiler.dispose(first);
    compiler.dispose(second);
    expect(created[0].dispose).not.toHaveBeenCalled();
    compiler.clearCache();
    compiler.clearCache();
    for (const value of created) expect(value.dispose).toHaveBeenCalledTimes(1);
  });

  it('separates paint styles and invalidates shaped text when font registration changes', () => {
    const { options, fonts, created, createParagraph, display, command } = fixture();
    const compiler = new SkiaPictureCompiler();
    compiler.compile(display(), options);
    compiler.compile(display({ ...command, paint: { ...command.paint,
      font: { ...command.paint.font, sizePx: 20 } } }), options);
    expect(createParagraph).toHaveBeenCalledTimes(4);
    fonts.generation += 1;
    compiler.compile(display(), options);
    expect(createParagraph).toHaveBeenCalledTimes(6);
    for (const value of created.slice(0, 4)) expect(value.dispose).toHaveBeenCalledTimes(1);
    compiler.clearCache();
  });

  it('releases a paragraph after failed layout so another compilation can retry', () => {
    const { options, createParagraph, display } = fixture();
    const failed = { layout: vi.fn(() => { throw new Error('layout failed'); }),
      getLineMetrics: vi.fn(), paint: vi.fn(), dispose: vi.fn() };
    createParagraph.mockReturnValueOnce(failed);
    const compiler = new SkiaPictureCompiler();
    expect(() => compiler.compile(display(), options)).toThrow('layout failed');
    expect(failed.dispose).toHaveBeenCalledTimes(1);
    compiler.compile(display(), options);
    expect(createParagraph).toHaveBeenCalledTimes(3);
    compiler.clearCache();
  });
});

describe('paragraph cache resource bounds', () => {
  it('evicts the least recently used paragraph and releases each native object once', () => {
    const cache = new ReaderParagraphCache(2);
    const a = paragraph(); const b = paragraph(); const c = paragraph();
    cache.getOrCreate('a', () => a);
    cache.getOrCreate('b', () => b);
    expect(cache.getOrCreate('a', () => { throw new Error('cache miss'); })).toBe(a);
    cache.getOrCreate('c', () => c);
    expect(b.paragraph.dispose).toHaveBeenCalledTimes(1);
    expect(a.paragraph.dispose).not.toHaveBeenCalled();
    cache.clear(); cache.clear();
    for (const entry of [a, b, c]) expect(entry.paragraph.dispose).toHaveBeenCalledTimes(1);
  });

  it('bounds retained text and keeps one oversized run alive until its caller paints it', () => {
    const cache = new ReaderParagraphCache(10, 4);
    const a = paragraph(); const b = paragraph(); const large = paragraph();
    cache.getOrCreate('abc', () => a);
    cache.getOrCreate('de', () => b);
    expect(a.paragraph.dispose).toHaveBeenCalledTimes(1);
    cache.getOrCreate('oversized', () => large);
    expect(b.paragraph.dispose).toHaveBeenCalledTimes(1);
    expect(large.paragraph.dispose).not.toHaveBeenCalled();
    cache.clear();
    expect(large.paragraph.dispose).toHaveBeenCalledTimes(1);
  });
});
