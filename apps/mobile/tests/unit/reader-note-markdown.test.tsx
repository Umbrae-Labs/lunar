import React, { type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toDisplayMarkdown, markdownLink } from '../../src/components/markdown/markdown-format';
import { MarkdownView } from '../../src/components/markdown/markdown-view';
import { Linking } from 'react-native';

const renderer = vi.hoisted(() => ({ props: undefined as any }));
vi.mock('expensify-common/ExpensiMark', async () => {
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('expensify-common/ExpensiMark');
});
vi.mock('react-native-markdown-renderer', async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const libraryRequire = createRequire(require.resolve('react-native-markdown-renderer'));
  return { MarkdownIt: libraryRequire('markdown-it'), default: (props: any) => {
    renderer.props = props;
    return null;
  } };
});
vi.mock('uniwind', () => ({ useResolveClassNames: () => ({ color: '#ffffff' }) }));

vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children, className, accessibilityRole }: { children: ReactNode; className?: string; accessibilityRole?: string }) =>
    <span className={className} role={accessibilityRole}>{children}</span>,
  Image: ({ source, accessibilityLabel }: { source: { uri: string }; accessibilityLabel?: string }) => <img src={source.uri} alt={accessibilityLabel} />,
  Linking: { openURL: vi.fn().mockResolvedValue(undefined) },
}));
beforeEach(() => { vi.stubGlobal('React', React); vi.clearAllMocks(); });
afterEach(() => vi.unstubAllGlobals());

describe('shared Markdown view', () => {
  it('lets the caller handle links and reports failures without owning notifications', async () => {
    const error = new Error('Cannot open link');
    const onLinkPress = vi.fn().mockRejectedValue(error);
    const onLinkError = vi.fn();
    renderToStaticMarkup(<MarkdownView value="[link](https://example.com)" onLinkPress={onLinkPress} onLinkError={onLinkError} />);
    renderer.props.onLinkPress('https://example.com');
    await vi.waitFor(() => expect(onLinkError).toHaveBeenCalledWith(error));
    expect(onLinkPress).toHaveBeenCalledWith('https://example.com/');
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
  it.each([1, 2, 3, 4, 5, 6])('renders level %i headings in saved notes', (level) => {
    renderToStaticMarkup(<MarkdownView value={`${'#'.repeat(level)} 这是什么`} />);
    const html = renderer.props.markdownit.render(renderer.props.children);
    expect(html).toContain(`<h${level}>这是什么</h${level}>`);
  });
  it('keeps heading-like text inside code literal and preserves inline emphasis', () => {
    renderToStaticMarkup(<MarkdownView value={'## *标题*\n\n```\n## 代码\n```\n\n`### 原文`'} />);
    const html = renderer.props.markdownit.render(renderer.props.children);
    expect(html).toContain('<h2><strong>标题</strong></h2>');
    expect(html).toContain('## 代码');
    expect(html).toContain('### 原文');
    expect(html).not.toContain('<h2>代码');
    expect(html).not.toContain('<h3>原文');
  });
  it('uses the Live Markdown dialect for the display adapter', () => {
    expect(toDisplayMarkdown('*粗体* _斜体_ ~删除~')).toBe('**粗体** *斜体* ~~删除~~');
  });
  it('preserves literal code after converting the editor dialect', () => {
    renderToStaticMarkup(<MarkdownView value={'```\nconst x = 1;\n```'} />);
    const html = renderer.props.markdownit.render(renderer.props.children);
    expect(html).toContain('const x = 1;');
    expect(html).not.toContain('&amp;#32;');
  });
  it('delegates CommonMark content to the library parser and renderer', () => {
    const value = '# 标题\n\n*重要 _想法_*\n\n> 引用\n\n- 完成\n- 待办\n\n```ts\nconst x = 1;\n```\n\n| 列名 |\n| --- |\n| 内容 |';
    renderToStaticMarkup(<MarkdownView value={value} />);
    expect(renderer.props.children).toBe(toDisplayMarkdown(value));
    const markup = renderer.props.markdownit.render(renderer.props.children);
    expect(markup).toContain('<h1>');
    expect(markup).toContain('<strong>');
    expect(markup).toContain('<em>');

    expect(markup).toContain('引用');
    expect(markup).toContain('const x = 1;');
    expect(markup).toContain('列名');
    expect(markup).toContain('内容');
  });
  it('treats HTML as text and permits only supported external link schemes', () => {
    renderToStaticMarkup(<MarkdownView value={'<script>alert(1)</script>\n\n[unsafe](javascript:alert)\n\n[safe](https://example.com)'} />);
    const markup = renderer.props.markdownit.render(renderer.props.children);
    expect(markup).not.toContain('<script>');
    expect(markup.match(/<a /g)).toHaveLength(1);
    renderer.props.onLinkPress('file:///private/file');
    expect(Linking.openURL).not.toHaveBeenCalled();
    renderer.props.onLinkPress('https://example.com');
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/');
    expect(markdownLink('https://example.com/path')).toBe('https://example.com/path');
    expect(markdownLink('mailto:test@example.com')).toBe('mailto:test@example.com');
    for (const url of ['javascript:alert(1)', 'file:///private/file', 'data:text/html,a', '../book.xhtml']) {
      expect(markdownLink(url)).toBeUndefined();
    }
  });
});
