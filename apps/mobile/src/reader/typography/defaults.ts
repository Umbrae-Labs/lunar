import type { ReaderTypography } from '../contracts';
import { LUNAR_READER_BUILTIN_FONT_REF } from './builtin-font';

export const DEFAULT_READER_TYPOGRAPHY: Readonly<ReaderTypography> = {
  fonts: {
    body: LUNAR_READER_BUILTIN_FONT_REF,
    chrome: LUNAR_READER_BUILTIN_FONT_REF,
  },
  fontSize: 18,
  lineHeight: 1.65,
  marginHorizontal: 24,
  marginVertical: 36,
  spreadMode: 'single',
};
