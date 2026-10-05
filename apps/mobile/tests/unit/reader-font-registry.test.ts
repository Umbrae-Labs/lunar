import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LunarSkiaFontRegistry } from '../../src/reader/skia/fonts/font-registry';
import { LUNAR_READER_FONT_FAMILY } from '../../src/reader/typography';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const state = vi.hoisted(() => ({
  dataDisposed: 0,
  decoded: [] as Uint8Array[],
  disposedFonts: 0,
  disposedTypefaces: 0,
  matchedFamilies: [] as string[],
  providerDisposed: 0,
  registered: [] as { name: string; typeface: unknown }[],
  systemMgr: {
    dispose: () => undefined,
    matchFamilyStyle: () => ({
      dispose: () => {
        state.disposedTypefaces += 1;
      },
    }),
  } as { dispose?(): void; matchFamilyStyle(family: string): unknown },
}));

vi.mock('@shopify/react-native-skia', () => ({
  FontSlant: { Italic: 'italic', Upright: 'upright' },
  FontWidth: { Normal: 'normal' },
  Skia: {
    Data: {
      fromBytes: (bytes: Uint8Array) => ({
        bytes,
        dispose: () => {
          state.dataDisposed += 1;
        },
      }),
    },
    Typeface: {
      MakeFreeTypeFaceFromData: (data: { bytes: Uint8Array }) => {
        state.decoded.push(data.bytes);
        return {
          dispose: () => {
            state.disposedTypefaces += 1;
          },
        };
      },
    },
    Font: () => ({
      dispose: () => {
        state.disposedFonts += 1;
      },
    }),
    TypefaceFontProvider: {
      Make: () => ({
        dispose: () => {
          state.providerDisposed += 1;
        },
        matchFamilyStyle: (family: string) => {
          state.matchedFamilies.push(family);
          return { family };
        },
        registerFont: (typeface: unknown, name: string) => {
          state.registered.push({ name, typeface });
        },
      }),
    },
  },
}));

vi.mock('../../src/reader/skia/fonts/system-fonts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/reader/skia/fonts/system-fonts')>(),
  createSystemFontMgr: () => state.systemMgr,
  hasSystemReaderFontFamily: (family: string) => family === 'Noto Sans',
}));

const BUNDLED = new Uint8Array([1, 2, 3]);
const IMPORTED = new Uint8Array([4, 5, 6]);

beforeEach(() => {
  state.dataDisposed = 0;
  state.decoded = [];
  state.disposedFonts = 0;
  state.disposedTypefaces = 0;
  state.matchedFamilies = [];
  state.providerDisposed = 0;
  state.registered = [];
  Object.defineProperty(state.systemMgr, 'dispose', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

describe('Skia reader font registry', () => {
  it('preserves body paragraph generation when chrome fonts are added', () => {
    const registry = new LunarSkiaFontRegistry();
    registry.loadBuiltinFont(BUNDLED, '__RitoPinned_builtin');
    const generation = registry.generation;
    registry.registerChromeFontFace({ family: 'Noto Sans', source: 'system' });
    registry.registerChromeFontFace({ family: 'Imported', source: 'imported', bytes: IMPORTED });
    expect(registry.generation).toBe(generation);
    registry.resolveFont({ family: 'Noto Sans', sizePx: 14, weight: 400, style: 'normal' });
    expect(state.matchedFamilies).toEqual(['Noto Sans']);
    registry.registerFontFace({ family: 'Imported', source: 'imported', bytes: IMPORTED }, '__RitoPinned_imported');
    expect(registry.generation).toBeGreaterThan(generation);
    registry.dispose();
  });
  it('registers the bundled face under both of the names it is asked for', () => {
    const registry = new LunarSkiaFontRegistry();
    registry.loadBuiltinFont(BUNDLED, '__RitoPinned_abc');

    expect(registeredNames()).toEqual([LUNAR_READER_FONT_FAMILY, '__RitoPinned_abc']);
    expect(state.decoded).toEqual([BUNDLED]);
  });

  // Rito paints an imported body face under its pinned alias only, so a face
  // registered under its family alone would lay out with one font and paint with
  // another. Chrome asks for the family, so both names have to resolve.
  it('registers an imported face under its family and its pinned alias', () => {
    const registry = new LunarSkiaFontRegistry();
    registry.registerFontFace(
      { family: 'Source Han Serif', source: 'imported', bytes: IMPORTED },
      '__RitoPinned_def',
    );

    expect(registeredNames()).toEqual(['Source Han Serif', '__RitoPinned_def']);
    expect(state.decoded).toEqual([IMPORTED]);
  });

  it('decodes a face once however many names it is registered under', () => {
    const registry = new LunarSkiaFontRegistry();
    const face = { family: 'Source Han Serif', source: 'imported' as const, bytes: IMPORTED };

    registry.registerFontFace(face, '__RitoPinned_def');
    registry.registerFontFace(face, '__RitoPinned_def');
    registry.loadBuiltinFont(BUNDLED, '__RitoPinned_abc');

    expect(state.decoded).toEqual([IMPORTED, BUNDLED]);
    expect(state.registered).toHaveLength(4);
  });

  it('refuses a face it cannot decode rather than registering nothing silently', () => {
    const registry = new LunarSkiaFontRegistry();

    expect(() => registry.registerFontFace({ family: 'X', source: 'imported' })).toThrow(
      /requires bytes/,
    );
    expect(() =>
      registry.registerFontFace({ family: '  ', source: 'imported', bytes: IMPORTED }),
    ).toThrow(/requires a family/);
    expect(() => registry.registerFontFace({ family: 'X', source: 'imported', bytes: new Uint8Array() }))
      .toThrow(/requires bytes/);
  });

  it('adopts a system face the platform actually enumerates', () => {
    const registry = new LunarSkiaFontRegistry();
    registry.registerFontFace({ family: 'Noto Sans', source: 'system' });

    expect(registeredNames()).toEqual(['Noto Sans']);
    expect(state.decoded).toEqual([]);
  });

  it('uses the selected system family for chrome text', () => {
    const registry = new LunarSkiaFontRegistry();
    registry.loadBuiltinFont(BUNDLED);
    registry.registerFontFace({ family: 'Noto Sans', source: 'system' });

    expect(registry.getFontFamilies('Noto Sans')).toEqual(['Noto Sans', LUNAR_READER_FONT_FAMILY]);
    registry.resolveFont({ family: 'Noto Sans', sizePx: 14, weight: 400, style: 'normal' });
    expect(state.matchedFamilies).toEqual(['Noto Sans']);
  });

  it('finishes session cleanup when the native system manager has no dispose method', () => {
    const readDispose = vi.fn(() => { throw new TypeError('undefined is not a function'); });
    Object.defineProperty(state.systemMgr, 'dispose', { configurable: true, get: readDispose });
    const registry = new LunarSkiaFontRegistry();
    registry.loadBuiltinFont(BUNDLED);
    registry.registerFontFace({ family: 'Noto Sans', source: 'system' });

    expect(() => registry.dispose()).not.toThrow();
    registry.dispose();
    expect(state.disposedTypefaces).toBe(2);
    expect(state.providerDisposed).toBe(1);
    expect(readDispose).not.toHaveBeenCalled();
    expect(() => registry.loadBuiltinFont(BUNDLED)).toThrow(/disposed/);
  });

  // `matchFamilyStyle` hands back a face that aborts the process on first use
  // when the family is unknown, so the enumeration has to gate it.
  it('refuses a system family the platform does not enumerate', () => {
    const registry = new LunarSkiaFontRegistry();

    expect(() => registry.registerFontFace({ family: 'Nonexistent', source: 'system' })).toThrow(
      /unavailable/,
    );
  });

  it('resolves chrome text through the first registered name in the stack', () => {
    const registry = new LunarSkiaFontRegistry();
    registry.loadBuiltinFont(BUNDLED);
    registry.registerFontFace({ family: 'Imported', source: 'imported', bytes: IMPORTED });

    registry.resolveFont({ family: 'Unknown, Imported', sizePx: 14, weight: 400, style: 'normal' });
    registry.resolveFont({ family: 'Unknown', sizePx: 14, weight: 400, style: 'normal' });

    expect(state.matchedFamilies).toEqual(['Imported', LUNAR_READER_FONT_FAMILY]);
  });

  it('offers the bundled family as the tail of every family stack', () => {
    const registry = new LunarSkiaFontRegistry();
    registry.loadBuiltinFont(BUNDLED);
    registry.registerFontFace({ family: 'Imported', source: 'imported', bytes: IMPORTED });

    expect(registry.getFontFamilies('Unknown, Imported')).toEqual([
      'Imported',
      LUNAR_READER_FONT_FAMILY,
    ]);
  });

  it('releases everything it decoded and refuses further use', () => {
    const registry = new LunarSkiaFontRegistry();
    registry.loadBuiltinFont(BUNDLED);
    registry.registerFontFace({ family: 'Imported', source: 'imported', bytes: IMPORTED });
    registry.registerFontFace({ family: 'Noto Sans', source: 'system' });
    registry.resolveFont({ family: LUNAR_READER_FONT_FAMILY, sizePx: 14, weight: 400, style: 'normal' });

    registry.dispose();
    registry.dispose();

    expect(state.disposedTypefaces).toBe(3);
    expect(state.disposedFonts).toBe(1);
    expect(state.providerDisposed).toBe(1);
    expect(state.dataDisposed).toBe(2);
    expect(state.systemMgr.dispose).not.toHaveBeenCalled();
    expect(() => registry.loadBuiltinFont(BUNDLED)).toThrow(/disposed/);
  });
});

function registeredNames(): readonly string[] {
  return state.registered.map((entry) => entry.name);
}
