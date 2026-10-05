import { describe, expect, it } from 'vitest';
import { formatMarkdown, formatMarkdownSelection } from '../../src/components/markdown/markdown-edit';

describe('Markdown toolbar edits', () => {
  it.each([
    ['formatBold', '*'],
    ['formatItalic', '_'],
  ])('handles the library callback %s', (command, marker) => {
    expect(formatMarkdownSelection('中文', 0, 2, command)).toEqual({
      updatedText: `${marker}中文${marker}`,
      cursorOffset: 2,
      selection: { start: 1, end: 3 },
    });
    expect(formatMarkdownSelection(`${marker}中文${marker}`, 1, 3, command)).toEqual({
      updatedText: '中文',
      cursorOffset: -1,
      selection: { start: 0, end: 2 },
    });
    expect(formatMarkdownSelection(`${marker}中文${marker}`, 0, 4, command)).toEqual({
      updatedText: '中文',
      cursorOffset: -2,
      selection: { start: 0, end: 2 },
    });
  });
  it('keeps unsupported commands and over-limit formatting unchanged', () => {
    expect(formatMarkdownSelection('原文', 0, 2, 'formatUnderline')).toEqual({
      updatedText: '原文',
      cursorOffset: 0,
      selection: { start: 0, end: 2 },
    });
    expect(formatMarkdownSelection('原文', 0, 2, 'formatBold', 3).updatedText).toBe('原文');
  });
  it.each([
    ['bold', '*'],
    ['italic', '_'],
    ['strikethrough', '~'],
    ['code', '`'],
  ] as const)('toggles %s around a UTF-16 selection', (format, marker) => {
    const value = '😀斜体内容';
    const selection = { start: 2, end: 4 };
    const edit = formatMarkdown(value, selection, format);
    expect(edit).toEqual({ value: `😀${marker}斜体${marker}内容`, selection: { start: 3, end: 5 } });
    expect(formatMarkdown(edit.value, edit.selection, format)).toEqual({ value, selection });
  });
  it('puts an empty caret inside markers and unwraps a fully selected format', () => {
    expect(formatMarkdown('前后', { start: 1, end: 1 }, 'italic')).toEqual({
      value: '前__后',
      selection: { start: 2, end: 2 },
    });
    expect(formatMarkdown('_斜体_', { start: 0, end: 4 }, 'italic')).toEqual({
      value: '斜体',
      selection: { start: 0, end: 2 },
    });
  });
  it('quotes only selected lines and preserves the selection through toggling', () => {
    const value = '第一行\n第二行\n第三行';
    const selection = { start: 0, end: 8 };
    const edit = formatMarkdown(value, selection, 'quote');
    expect(edit).toEqual({ value: '> 第一行\n> 第二行\n第三行', selection: { start: 2, end: 12 } });
    expect(formatMarkdown(edit.value, edit.selection, 'quote')).toEqual({ value, selection });
  });
  it('cycles heading levels and handles a caret inside the removed prefix', () => {
    let edit = { value: '标题', selection: { start: 2, end: 2 } };
    for (let level = 1; level <= 6; level++) {
      edit = formatMarkdown(edit.value, edit.selection, 'heading');
      expect(edit.value).toBe(`${'#'.repeat(level)} 标题`);
      expect(edit.selection).toEqual({ start: edit.value.length, end: edit.value.length });
    }
    expect(formatMarkdown(edit.value, edit.selection, 'heading')).toEqual({
      value: '标题',
      selection: { start: 2, end: 2 },
    });
    expect(formatMarkdown('> 引用', { start: 1, end: 1 }, 'quote')).toEqual({
      value: '引用',
      selection: { start: 0, end: 0 },
    });
    expect(formatMarkdown('\n正文', { start: 0, end: 0 }, 'heading').value).toBe('# \n正文');
  });
  it('creates code fences on their own lines and selects their content', () => {
    const edit = formatMarkdown('前代码后', { start: 1, end: 3 }, 'codeBlock');
    expect(edit).toEqual({ value: '前\n```\n代码\n```\n后', selection: { start: 6, end: 8 } });
    expect(formatMarkdown(edit.value, edit.selection, 'codeBlock').value).toBe('前\n代码\n后');
  });
  it('selects the link destination and rejects edits beyond the character limit', () => {
    expect(formatMarkdown('链接', { start: 0, end: 2 }, 'link')).toEqual({
      value: '[链接](https://)',
      selection: { start: 5, end: 13 },
    });
    expect(formatMarkdown('满了', { start: 0, end: 2 }, 'bold', 3)).toEqual({
      value: '满了',
      selection: { start: 0, end: 2 },
    });
  });
});
