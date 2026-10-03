import { describe, expect, it } from 'vitest';

import { normalizeReaderDisplayText } from '../../src/features/reader/domain/reader-display-text';

describe('normalizeReaderDisplayText', () => {
  it('joins visual line breaks between CJK text without inserting spaces', () => {
    expect(normalizeReaderDisplayText('一直默默观察对话走向的天爱星\n同学，像是突然意识到什么')).toBe(
      '一直默默观察对话走向的天爱星同学，像是突然意识到什么',
    );
  });

  it('keeps a word separator when an English line wraps', () => {
    expect(normalizeReaderDisplayText('A long\nEnglish sentence')).toBe('A long English sentence');
  });

  it('preserves paragraph breaks', () => {
    expect(normalizeReaderDisplayText('第一段\n换行\n\n第二段')).toBe('第一段换行\n\n第二段');
  });

  it('restores a paragraph before a new quote in older selections', () => {
    expect(
      normalizeReaderDisplayText('了背。\n「啊，好的！那么温水同学\n请在这里签名——」\n天爱星同学正要伸手拿文件'),
    ).toBe('了背。\n\n「啊，好的！那么温水同学请在这里签名——」\n\n天爱星同学正要伸手拿文件');
  });
});
