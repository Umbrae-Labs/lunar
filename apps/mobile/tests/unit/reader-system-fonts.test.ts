import { beforeEach, describe, expect, it, vi } from 'vitest';

const system = vi.hoisted(() => vi.fn());
const platform = vi.hoisted(() => ({ OS: 'android' }));

vi.mock('react-native', () => ({ Platform: platform }));

vi.mock('@shopify/react-native-skia', () => ({
  Skia: { FontMgr: { System: system } },
}));

beforeEach(() => {
  vi.resetModules();
  system.mockReset();
  platform.OS = 'android';
});

describe('system reader fonts', () => {
  it.each(['android', 'ios'])('never reads a missing native dispose property on %s', async (os) => {
    platform.OS = os;
    const readDispose = vi.fn(() => { throw new TypeError('undefined is not a function'); });
    const manager = {
      countFamilies: () => 1,
      getFamilyName: () => 'Noto Sans',
    };
    Object.defineProperty(manager, 'dispose', { get: readDispose });
    system.mockReturnValue(manager);
    const { listSystemReaderFontFamilies } = await import('../../src/reader/skia/fonts/system-fonts');

    expect(listSystemReaderFontFamilies()).toEqual(['Noto Sans']);
    expect(readDispose).not.toHaveBeenCalled();
  });

  it('enumerates and caches native families when the manager has no dispose method', async () => {
    const names = ['Noto Serif', '.Internal', 'Noto Sans', '', 'Noto Serif'];
    const countFamilies = vi.fn(() => names.length);
    system.mockReturnValue({ countFamilies, getFamilyName: (index: number) => names[index] });
    const { listSystemReaderFontFamilies, hasSystemReaderFontFamily } = await import(
      '../../src/reader/skia/fonts/system-fonts'
    );

    const families = listSystemReaderFontFamilies();
    expect(families).toEqual(['Noto Sans', 'Noto Serif']);
    expect(listSystemReaderFontFamilies()).toBe(families);
    expect(hasSystemReaderFontFamily('Noto Sans')).toBe(true);
    expect(hasSystemReaderFontFamily('.Internal')).toBe(false);
    expect(hasSystemReaderFontFamily('Missing')).toBe(false);
    expect(system).toHaveBeenCalledTimes(1);
    expect(countFamilies).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('handles unavailable enumeration with dispose present: %s', async (canDispose) => {
    platform.OS = canDispose ? 'web' : 'android';
    const dispose = vi.fn();
    system.mockReturnValue({
      countFamilies: () => { throw new Error('Enumeration unavailable'); },
      ...(canDispose ? { dispose } : {}),
    });
    const { listSystemReaderFontFamilies } = await import('../../src/reader/skia/fonts/system-fonts');

    expect(listSystemReaderFontFamilies()).toEqual([]);
    expect(dispose).toHaveBeenCalledTimes(canDispose ? 1 : 0);
  });

  it('releases managers that expose dispose after successful enumeration', async () => {
    platform.OS = 'web';
    const dispose = vi.fn();
    system.mockReturnValue({
      countFamilies: () => 1,
      getFamilyName: () => 'Noto Sans',
      dispose,
    });
    const { listSystemReaderFontFamilies } = await import('../../src/reader/skia/fonts/system-fonts');

    expect(listSystemReaderFontFamilies()).toEqual(['Noto Sans']);
    listSystemReaderFontFamilies();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('offers no system families when manager creation fails', async () => {
    system.mockImplementation(() => { throw new Error('System manager unavailable'); });
    const { listSystemReaderFontFamilies, hasSystemReaderFontFamily } = await import(
      '../../src/reader/skia/fonts/system-fonts'
    );

    expect(listSystemReaderFontFamilies()).toEqual([]);
    expect(hasSystemReaderFontFamily('Noto Sans')).toBe(false);
    expect(system).toHaveBeenCalledTimes(1);
  });
});
