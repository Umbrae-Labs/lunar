import { createRequire } from 'node:module';
import * as React from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PageCurlMesh } from '../../src/reader/skia/anime/effects/curl/page-curl';

vi.mock('@shopify/react-native-skia', () => ({
  ImageShader: 'ImageShader', Picture: 'Picture', Rect: 'Rect', Shader: 'Shader',
  Skia: { RuntimeEffect: { Make: (source: string) => source } },
}));
vi.mock('react-native', () => ({ PixelRatio: { get: () => 1 } }));
vi.mock('react-native-reanimated', () => ({
  useDerivedValue: (compute: () => unknown) => ({ value: compute() }),
  useSharedValue: (value: unknown) => ({ value }),
}));
vi.mock('react-native-worklets', () => ({ runOnUI: vi.fn(), scheduleOnRN: vi.fn() }));

// Use the Skia dependency's own CanvasKit: execute the actual SkSL, rather
// than replacing the face decision with a JavaScript approximation.
const require = createRequire(import.meta.url);
const skiaRequire = createRequire(require.resolve('@shopify/react-native-skia/package.json'));
let kit: ReturnType<typeof skiaRequire>;
const width = 400;
const height = 200;

beforeAll(async () => {
  vi.stubGlobal('React', React);
  kit = await skiaRequire('canvaskit-wasm')({
    locateFile: () => skiaRequire.resolve('canvaskit-wasm/bin/canvaskit.wasm'),
  });
});
afterAll(() => vi.unstubAllGlobals());

function render(progress: number, direction: 1 | -1, gestureDriven = false, spreadMode: 'single' | 'double' = 'single') {
  const incoming = spreadMode === 'single' && direction === -1;
  const element = PageCurlMesh({
    picture: {} as Parameters<typeof PageCurlMesh>[0]['picture'],
    texture: { ready: true, image: { value: null } as never },
    width, height, direction, spreadMode, gestureDriven,
    progress: { value: progress } as never,
    grabX: incoming ? width * 0.6 : direction > 0 ? 0 : width,
    grabY: height / 2,
    paperColor: '#000000',
    phase: incoming ? 'incoming-landing' : 'full',
  });
  const shaderProps = element!.props.children.props;
  const effect = kit.RuntimeEffect.Make(shaderProps.source, (error: string) => { throw new Error(error); });
  expect(effect).toBeTruthy();
  const uniforms = shaderProps.uniforms.value;
  const data = Array.from({ length: effect.getUniformCount() }, (_, index) =>
    uniforms[effect.getUniformName(index)]).flat();
  const frontEffect = kit.RuntimeEffect.Make(`half4 main(float2 p) {
    return p.x < 0.333 ? half4(1, 0, 0, 1) : p.x < 0.667 ? half4(0, 1, 0, 1) : half4(0, 0, 1, 1);
  }`);
  const front = frontEffect.makeShader([]);
  const shader = effect.makeShaderWithChildren(data, [front]);
  const surface = kit.MakeSurface(width, height);
  const paint = new kit.Paint();
  const canvas = surface.getCanvas();
  canvas.clear(kit.Color(255, 255, 0, 1));
  paint.setShader(shader);
  canvas.drawRect(kit.XYWHRect(0, 0, width, height), paint);
  const pixels = canvas.readPixels(0, 0, {
    width, height, colorType: kit.ColorType.RGBA_8888,
    alphaType: kit.AlphaType.Unpremul, colorSpace: kit.ColorSpace.SRGB,
  });
  const pixel = (x: number) => Array.from(pixels.slice((height / 2 * width + x) * 4, (height / 2 * width + x) * 4 + 4));
  surface.delete(); paint.delete(); shader.delete(); front.delete(); frontEffect.delete(); effect.delete();
  return pixel;
}

describe('curl printed face rendering', () => {
  it.each([false, true])('prints the landed front and keeps the folded back opaque and blank, gesture=%s', (gesture) => {
    const pixel = render(gesture ? 0.35 : 0.29, -1, gesture);
    // The left strip has landed; the folded strip is blank stock; the far
    // right still exposes the yellow background beneath the moving sheet.
    expect(pixel(10)).toEqual([255, 0, 0, 255]);
    expect(pixel(390)).toEqual([255, 255, 0, 255]);
    const blankPixels = Array.from({ length: width }, (_, x) => pixel(x))
      .filter(([r, g, b, a]) => r === 0 && g === 0 && b === 0 && a === 255);
    expect(blankPixels.length).toBeGreaterThan(10);
  }, 15000);
  it.each([false, true])('lands the previous page right-side-up, gesture=%s', (gesture) => {
    const pixel = render(1, -1, gesture);
    expect(pixel(40)).toEqual([255, 0, 0, 255]);
    expect(pixel(200)).toEqual([0, 255, 0, 255]);
    expect(pixel(360)).toEqual([0, 0, 255, 255]);
  }, 15000);

  it('starts a next-page turn with the printed face right-side-up', () => {
    const pixel = render(0, 1);
    expect(pixel(40)).toEqual([255, 0, 0, 255]);
    expect(pixel(360)).toEqual([0, 0, 255, 255]);
  }, 15000);

  it('preserves the outgoing face in double-page backward turns', () => {
    const pixel = render(0, -1, false, 'double');
    expect(pixel(40)).toEqual([0, 0, 255, 255]);
    expect(pixel(360)).toEqual([255, 0, 0, 255]);
  }, 15000);
});
