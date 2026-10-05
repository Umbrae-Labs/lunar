import { describe, expect, it, vi } from 'vitest';
import type { SkCanvas } from '@shopify/react-native-skia';

import type { ReaderResolvedPrimitiveList } from '../../src/reader/contracts';
import { makeResolvedPrimitivePath, renderResolvedPrimitives, type ReaderPrimitiveRenderOptions } from '../../src/reader/skia/rendering/primitive-renderer';

const { pathCalls } = vi.hoisted(() => ({ pathCalls: [] as unknown[][] }));

vi.mock('@shopify/react-native-skia', () => ({
  FillType: { EvenOdd: 'even-odd', Winding: 'winding' },
  Skia: {
    XYWHRect: (x: number, y: number, width: number, height: number) => ({ x, y, width, height }),
    Paint: () => ({ setAntiAlias() {}, setColor() {}, setAlphaf() {}, dispose() {} }),
    PathBuilder: { Make: () => ({
      setFillType: (value: string) => { pathCalls.push(['fill', value]); },
      moveTo: (x: number, y: number) => { pathCalls.push(['move', x, y]); },
      lineTo: (x: number, y: number) => { pathCalls.push(['line', x, y]); },
      arcToOval: (...args: unknown[]) => { pathCalls.push(['arc', ...args]); },
      addOval: (value: unknown) => { pathCalls.push(['oval', value]); },
      addRect: (value: unknown) => { pathCalls.push(['rect', value]); },
      close: () => { pathCalls.push(['close']); },
      build: () => { pathCalls.push(['build']); return { dispose() {} }; },
      dispose: () => { pathCalls.push(['dispose']); },
    }) },
  },
}));

describe('Rito resolved primitive rendering', () => {
  it('draws device geometry and CSS text at the Picture scale', () => {
    const draws: { kind: string; x: number; y: number; width?: number; scale: number }[] = [];
    const scales: number[] = [];
    const saved: number[] = [];
    let scale = 1;
    const canvas = {
      save() { saved.push(scale); },
      restore() { scale = saved.pop()!; },
      scale(x: number, y: number) { expect(y).toBe(x); scale *= x; scales.push(x); },
      drawRect(rect: { x: number; y: number; width: number }) {
        draws.push({ kind: 'rect', x: rect.x * scale, y: rect.y * scale, width: rect.width * scale, scale });
      },
    } as unknown as SkCanvas;
    const list: ReaderResolvedPrimitiveList = {
      formatVersion: 2,
      ratio: 2,
      commandCount: 2,
      commands: [
        {
          kind: 'fill-rect', rect: { x: 20, y: 40, width: 60, height: 80 }, ground: 'none',
          color: { space: 'srgb', component0: 1, component1: 1, component2: 1, alpha: 1,
            none: { component0: false, component1: false, component2: false, alpha: false } },
        },
        {
          kind: 'text', text: 'A', rect: { x: 10, y: 20, width: 30, height: 40 },
          paint: { font: { family: 'Test', sizePx: 12, weight: 400, style: 'normal' },
            color: { space: 'srgb', component0: 0, component1: 0, component2: 0, alpha: 1,
              none: { component0: false, component1: false, component2: false, alpha: false } },
            textShadows: [] },
          clusters: [{ byte: 0, x: 10, y: 20 }],
        },
      ],
    };
    const options = {
      pixelRatio: 1,
      images: { resolveImage: () => undefined },
      paragraphs: { createParagraph: () => ({
        layout() {}, getLineMetrics: () => [{ baseline: 8 }],
        paint(_canvas: SkCanvas, x: number, y: number) { draws.push({ kind: 'text', x: x * scale, y: y * scale, scale }); },
        dispose() {},
      }) },
    } as unknown as ReaderPrimitiveRenderOptions;

    renderResolvedPrimitives(canvas, list, options);

    expect(scales).toEqual([0.5, 2]);
    expect(draws).toEqual([
      { kind: 'rect', x: 10, y: 20, width: 30, scale: 0.5 },
      { kind: 'text', x: 10, y: 12, scale: 1 },
    ]);
    expect(scale).toBe(1);
  });

  it('builds mixed paths and fill rules through the current Skia path API', () => {
    pathCalls.length = 0;
    const path = makeResolvedPrimitivePath([
      { op: 'move-to', x: 1, y: 2 },
      { op: 'line-to', x: 3, y: 4 },
      { op: 'arc', cx: 10, cy: 20, rx: 5, ry: 6, start: 0, sweep: Math.PI },
      { op: 'ellipse', cx: 10, cy: 20, rx: 5, ry: 6 },
      { op: 'rect', x: 7, y: 8, width: 9, height: 10 },
      { op: 'close' },
    ], 'evenodd');

    expect(pathCalls).toEqual([
      ['fill', 'even-odd'],
      ['move', 1, 2],
      ['line', 3, 4],
      ['arc', { x: 5, y: 14, width: 10, height: 12 }, 0, 180, false],
      ['oval', { x: 5, y: 14, width: 10, height: 12 }],
      ['rect', { x: 7, y: 8, width: 9, height: 10 }],
      ['close'],
      ['build'],
      ['dispose'],
    ]);
    path.dispose();
  });
});
