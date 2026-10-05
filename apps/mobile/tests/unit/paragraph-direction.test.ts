import { describe, expect, it, vi } from 'vitest';

vi.mock('@shopify/react-native-skia', () => ({
  FontSlant: {}, FontWidth: {}, Skia: {}, TextAlign: {}, TextDirection: {},
}));

import { detectParagraphDirection } from '../../src/reader/skia/text/paragraph-factory';

describe('paragraph direction detection', () => {
  it('selects RTL for Hebrew and Arabic strong characters', () => {
    expect(detectParagraphDirection('שלום עולם')).toBe('rtl');
    expect(detectParagraphDirection('مرحبا بالعالم')).toBe('rtl');
  });

  it('keeps Chinese and Latin runs LTR', () => {
    expect(detectParagraphDirection('正文 text')).toBe('ltr');
  });
});
