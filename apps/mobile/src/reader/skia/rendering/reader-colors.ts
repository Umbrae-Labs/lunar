import { Skia } from '@shopify/react-native-skia';

import type { ReaderColor, ReaderColorSpace, ReaderResolvedColor } from '../../contracts';

export function skiaColor(value: ReaderColor | string): ReturnType<typeof Skia.Color> {
  if (typeof value === 'string') {
    try {
      return Skia.Color(value);
    } catch {
      return Skia.Color('transparent');
    }
  }
  const [r, g, b] = toSrgb(
    value.space,
    value.none.component0 ? 0 : value.components[0],
    value.none.component1 ? 0 : value.components[1],
    value.none.component2 ? 0 : value.components[2],
  );
  return new Float32Array([clamp(r), clamp(g), clamp(b), value.none.alpha ? 0 : clamp(value.alpha)]);
}

export function isGrayscaleColor(value: ReaderColor | string): boolean {
  const color = skiaColor(value);
  const red = color[0] ?? 0;
  const green = color[1] ?? 0;
  const blue = color[2] ?? 0;
  const alpha = color[3] ?? 1;
  return alpha > 0 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 0.0001;
}

function toSrgb(space: ReaderColorSpace, c0: number, c1: number, c2: number): [number, number, number] {
  if (space === 'srgb') return [c0, c1, c2];
  if (space === 'hsl') return hsl(c0, c1 / 100, c2 / 100);
  if (space === 'hwb') return hwb(c0, c1 / 100, c2 / 100);
  if (space === 'srgb-linear') return [linearToSrgb(c0), linearToSrgb(c1), linearToSrgb(c2)];
  if (space === 'oklab' || space === 'oklch') {
    const angle = space === 'oklch' ? (c2 * Math.PI) / 180 : 0;
    return linearRgbToSrgb(
      oklabToLinear(c0, space === 'oklch' ? c1 * Math.cos(angle) : c1, space === 'oklch' ? c1 * Math.sin(angle) : c2),
    );
  }
  if (space === 'lab' || space === 'lch') {
    const angle = space === 'lch' ? (c2 * Math.PI) / 180 : 0;
    const xyz = labToXyz(c0, space === 'lch' ? c1 * Math.cos(angle) : c1, space === 'lch' ? c1 * Math.sin(angle) : c2);
    return linearRgbToSrgb(
      matrix(
        d50ToD65(xyz),
        [
          3.2409699419, -1.5373831776, -0.4986107603, -0.9692436363, 1.8759675015, 0.0415550574, 0.0556300797,
          -0.2039769589, 1.0569715142,
        ],
      ),
    );
  }
  if (space === 'xyz-d65')
    return linearRgbToSrgb(
      matrix(
        [c0, c1, c2],
        [
          3.2409699419, -1.5373831776, -0.4986107603, -0.9692436363, 1.8759675015, 0.0415550574, 0.0556300797,
          -0.2039769589, 1.0569715142,
        ],
      ),
    );
  if (space === 'xyz-d50')
    return linearRgbToSrgb(
      matrix(
        d50ToD65([c0, c1, c2]),
        [
          3.2409699419, -1.5373831776, -0.4986107603, -0.9692436363, 1.8759675015, 0.0415550574, 0.0556300797,
          -0.2039769589, 1.0569715142,
        ],
      ),
    );
  if (space === 'display-p3' || space === 'display-p3-linear') {
    const linear =
      space === 'display-p3'
        ? ([srgbToLinear(c0), srgbToLinear(c1), srgbToLinear(c2)] as [number, number, number])
        : ([c0, c1, c2] as [number, number, number]);
    return linearRgbToSrgb(
      matrix(
        matrix(
          linear,
          [
            0.4865709486, 0.2656676932, 0.1982172852, 0.2289745641, 0.6917385218, 0.0792869141, 0, 0.0451133819,
            1.0439443689,
          ],
        ),
        [
          3.2409699419, -1.5373831776, -0.4986107603, -0.9692436363, 1.8759675015, 0.0415550574, 0.0556300797,
          -0.2039769589, 1.0569715142,
        ],
      ),
    );
  }
  if (space === 'a98-rgb') {
    const xyz = matrix(
      [signedPow(c0, 563 / 256), signedPow(c1, 563 / 256), signedPow(c2, 563 / 256)],
      [0.5767309, 0.185554, 0.1881852, 0.2973769, 0.6273491, 0.0752741, 0.0270343, 0.0706872, 0.9911085],
    );
    return linearRgbToSrgb(
      matrix(
        xyz,
        [
          3.2409699419, -1.5373831776, -0.4986107603, -0.9692436363, 1.8759675015, 0.0415550574, 0.0556300797,
          -0.2039769589, 1.0569715142,
        ],
      ),
    );
  }
  if (space === 'prophoto-rgb') {
    const xyz = d50ToD65(
      matrix(
        [prophotoToLinear(c0), prophotoToLinear(c1), prophotoToLinear(c2)],
        [0.7977666449, 0.1351812974, 0.0313477341, 0.2880748288, 0.7118352342, 0.0000899369, 0, 0, 0.8251046025],
      ),
    );
    return linearRgbToSrgb(
      matrix(
        xyz,
        [
          3.2409699419, -1.5373831776, -0.4986107603, -0.9692436363, 1.8759675015, 0.0415550574, 0.0556300797,
          -0.2039769589, 1.0569715142,
        ],
      ),
    );
  }
  if (space === 'rec2020') {
    const xyz = matrix(
      [rec2020ToLinear(c0), rec2020ToLinear(c1), rec2020ToLinear(c2)],
      [0.6369580483, 0.1446169036, 0.1688809752, 0.262700212, 0.6779980715, 0.0593017165, 0, 0.028072693, 1.0609850577],
    );
    return linearRgbToSrgb(
      matrix(
        xyz,
        [
          3.2409699419, -1.5373831776, -0.4986107603, -0.9692436363, 1.8759675015, 0.0415550574, 0.0556300797,
          -0.2039769589, 1.0569715142,
        ],
      ),
    );
  }
  return [c0, c1, c2];
}

function hsl(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = clamp(saturation);
  const l = clamp(lightness);
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueChannel(p, q, h + 1 / 3), hueChannel(p, q, h), hueChannel(p, q, h - 1 / 3)];
}

function hwb(hue: number, white: number, black: number): [number, number, number] {
  const w = clamp(white);
  const b = clamp(black);
  if (w + b >= 1) {
    const gray = w / (w + b);
    return [gray, gray, gray];
  }
  const base = hsl(hue, 1, 0.5);
  const scale = 1 - w - b;
  return [base[0] * scale + w, base[1] * scale + w, base[2] * scale + w];
}

function hueChannel(p: number, q: number, value: number): number {
  let h = value;
  if (h < 0) h += 1;
  if (h > 1) h -= 1;
  if (h < 1 / 6) return p + (q - p) * 6 * h;
  if (h < 0.5) return q;
  if (h < 2 / 3) return p + (q - p) * (2 / 3 - h) * 6;
  return p;
}

function linearToSrgb(value: number): number {
  const magnitude = Math.abs(value);
  const encoded = magnitude <= 0.0031308 ? magnitude * 12.92 : 1.055 * Math.pow(magnitude, 1 / 2.4) - 0.055;
  return value < 0 ? -encoded : encoded;
}

function srgbToLinear(value: number): number {
  const m = Math.abs(value);
  const l = m <= 0.04045 ? m / 12.92 : Math.pow((m + 0.055) / 1.055, 2.4);
  return value < 0 ? -l : l;
}
function signedPow(value: number, exponent: number): number {
  const result = Math.pow(Math.abs(value), exponent);
  return value < 0 ? -result : result;
}
function prophotoToLinear(value: number): number {
  const m = Math.abs(value);
  const l = m <= 16 / 512 ? m / 16 : Math.pow(m, 1.8);
  return value < 0 ? -l : l;
}
function rec2020ToLinear(value: number): number {
  const alpha = 1.09929682680944;
  const beta = 0.018053968510807;
  const m = Math.abs(value);
  const l = m < beta * 4.5 ? m / 4.5 : Math.pow((m + alpha - 1) / alpha, 1 / 0.45);
  return value < 0 ? -l : l;
}
function linearRgbToSrgb(value: [number, number, number]): [number, number, number] {
  return [linearToSrgb(value[0]), linearToSrgb(value[1]), linearToSrgb(value[2])];
}
function matrix(v: [number, number, number], m: number[]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}
function labToXyz(l: number, a: number, b: number): [number, number, number] {
  const f1 = (l + 16) / 116;
  return [labInv(f1 + a / 500) * 0.96422, labInv(f1), labInv(f1 - b / 200) * 0.82521];
}
function labInv(v: number): number {
  const d = 6 / 29;
  return v > d ? v * v * v : 3 * d * d * (v - 4 / 29);
}
function d50ToD65(v: [number, number, number]): [number, number, number] {
  return matrix(
    v,
    [
      0.9554734215, -0.0230984549, 0.0632592432, -0.0283697093, 1.0099953981, 0.0210414412, 0.0123140149, -0.0205076493,
      1.3303659262,
    ],
  );
}
function oklabToLinear(l: number, a: number, b: number): [number, number, number] {
  const ll = l + 0.3963377774 * a + 0.2158037573 * b;
  const mm = l - 0.1055613458 * a - 0.0638541728 * b;
  const ss = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = ll ** 3,
    m3 = mm ** 3,
    s3 = ss ** 3;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export interface SkiaColorOverride {
  readonly backgroundColor: ReaderColor | string;
  readonly foregroundColor: ReaderColor | string;
}

export function isOpaqueColor(color: ReaderColor | string): boolean {
  return (skiaColor(color)[3] ?? 1) >= 1;
}

export function isBookOwnedPageGround(color: ReaderColor | string): boolean {
  const value = skiaColor(color);
  return (value[3] ?? 1) >= 1 && relativeLuminance(value) < 0.75;
}

export function effectiveTextColor(
  original: ReaderColor | string,
  override: SkiaColorOverride | undefined,
  declaredGround?: ReaderColor | string,
): ReaderColor | string {
  if (!override || declaredGround) return original;
  const ink = skiaColor(original);
  const ground = skiaColor(override.backgroundColor);
  if (contrastRatio(ink, ground) >= 4.5) return original;
  return isGrayscaleColor(original) ? override.foregroundColor : original;
}

export function resolvedPrimitiveColor(value: ReaderResolvedColor): ReaderColor {
  return {
    space: value.space,
    components: [value.component0, value.component1, value.component2],
    alpha: value.alpha,
    none: value.none,
  };
}

export function makeResolvedPrimitivePaint(value: ReaderColor | string, alpha: number) {
  const paint = Skia.Paint();
  const resolved = skiaColor(value);
  paint.setAntiAlias(true);
  paint.setColor(resolved);
  paint.setAlphaf(Math.max(0, Math.min(1, alpha * (resolved[3] ?? 1))));
  return paint;
}

function contrastRatio(first: ArrayLike<number>, second: ArrayLike<number>): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function relativeLuminance(color: ArrayLike<number>): number {
  const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(color[0] ?? 0) + 0.7152 * channel(color[1] ?? 0) + 0.0722 * channel(color[2] ?? 0);
}
