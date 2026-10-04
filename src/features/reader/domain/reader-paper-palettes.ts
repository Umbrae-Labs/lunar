import type { ReaderRenderPalette } from '@/reader';
import type { ReaderAppearanceMode, ReaderPaperColor } from '@/stores';

function palette(backgroundColor: string, foregroundColor: string): ReaderRenderPalette {
  return { backgroundColor, foregroundColor, spreadBodyBackgroundColor: backgroundColor };
}

/** Content colors shared by the paper swatches, loading view and reader kernel. */
export const READER_PAPER_PALETTES: Readonly<
  Record<ReaderAppearanceMode, Readonly<Record<ReaderPaperColor, ReaderRenderPalette>>>
> = {
  light: {
    default: palette('#F8F8FA', '#202020'),
    warm: palette('#F4F0DF', '#302B22'),
    green: palette('#DDEEDB', '#1F2A20'),
    blue: palette('#E4EDF5', '#202A35'),
    gray: palette('#E7E7E7', '#262626'),
  },
  dark: {
    default: palette('#000000', '#D1D1D1'),
    warm: palette('#29231D', '#D8CFC2'),
    green: palette('#1D2923', '#C8D5CA'),
    blue: palette('#1D2530', '#C8D3E0'),
    gray: palette('#242424', '#D1D1D1'),
  },
};
