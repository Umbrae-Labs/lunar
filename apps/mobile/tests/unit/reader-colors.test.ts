import { describe, expect, it, vi } from 'vitest';

vi.mock('@shopify/react-native-skia', () => ({
  Skia: {
    Color: (value: string) => parseColor(value),
  },
}));

import {
  effectiveTextColor,
  isBookOwnedPageGround,
  isGrayscaleColor,
  skiaColor,
} from '../../src/reader/skia/rendering/reader-colors';

describe('Skia reader color override', () => {
  it('distinguishes a designed dark page from white paper', () => {
    expect(isBookOwnedPageGround('#111111')).toBe(true);
    expect(isBookOwnedPageGround('#ffffff')).toBe(false);
  });

  it('replaces unreadable achromatic ink on the theme ground', () => {
    expect(effectiveTextColor('#111111', {
      backgroundColor: '#000000',
      foregroundColor: '#ffffff',
    })).toBe('#ffffff');
  });

  it('recognizes opaque grayscale colors after adapting them to sRGB', () => {
    expect(isGrayscaleColor('#000000')).toBe(true);
    expect(isGrayscaleColor('#808080')).toBe(true);
    expect(isGrayscaleColor('#59b4d8')).toBe(false);
  });

  it('preserves colored ink even when it has insufficient contrast with the theme ground', () => {
    const override = { backgroundColor: '#ffffff', foregroundColor: '#000000' };
    expect(effectiveTextColor('#59b4d8', override)).toBe('#59b4d8');
    expect(effectiveTextColor('#dc5a91', override)).toBe('#dc5a91');
  });

  it('preserves the typesetter color when a declared ground contains the run', () => {
    expect(effectiveTextColor('#333333', {
      backgroundColor: '#000000', foregroundColor: '#ffffff',
    }, '#222222')).toBe('#333333');
  });

  it('converts typed linear and wide-gamut colors onto the sRGB surface', () => {
    const linear = skiaColor({
      space: 'srgb-linear', components: [1, 0, 0], alpha: 1,
      none: { component0: false, component1: false, component2: false, alpha: false },
    });
    const p3 = skiaColor({
      space: 'display-p3', components: [1, 0, 0], alpha: 1,
      none: { component0: false, component1: false, component2: false, alpha: false },
    });
    expect(linear[0]).toBe(1);
    expect(p3[0]).toBeGreaterThan(0.9);
    expect(p3[3]).toBe(1);
  });
});

function parseColor(value: string): Float32Array {
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const channels = hex.length === 3
      ? [...hex].map((part) => Number.parseInt(part + part, 16))
      : [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((part) => Number.parseInt(part, 16));
    return new Float32Array([channels[0] / 255, channels[1] / 255, channels[2] / 255, 1]);
  }
  const numbers = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
  return new Float32Array([numbers[0] / 255, numbers[1] / 255, numbers[2] / 255, numbers[3] ?? 1]);
}
