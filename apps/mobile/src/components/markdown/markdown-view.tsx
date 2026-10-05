import { Linking } from 'react-native';
import Markdown, { MarkdownIt } from 'react-native-markdown-renderer';
import { useMemo } from 'react';
import { useResolveClassNames } from 'uniwind';
import { toDisplayMarkdown, markdownLink } from './markdown-format';
import { decode } from 'html-entities';

const parser = new MarkdownIt({ html: false, linkify: true, breaks: true });
// The HTML converter preserves entities inside code. Decode only code tokens,
// after Markdown parsing, so literal code can never become HTML or formatting.
parser.core.ruler.after(
  'inline',
  'expensi-code-entities',
  (state: { tokens: { type: string; content: string; children?: { type: string; content: string }[] }[] }) => {
    for (const token of state.tokens) {
      if (token.type === 'fence' || token.type === 'code_block') token.content = decode(token.content);
      for (const child of token.children ?? []) {
        if (child.type === 'code_inline') child.content = decode(child.content);
      }
    }
  },
);
const ImageHandlers = ['https://', 'http://'];

/** Theme adapter; parsing and rendering are owned by the Markdown library. */
export interface MarkdownViewProps {
  readonly value: string;
  readonly onLinkPress?: (url: string) => void | Promise<unknown>;
  readonly onLinkError?: (error: unknown) => void;
}

export function MarkdownView({ value, onLinkPress, onLinkError }: MarkdownViewProps) {
  const markdown = useMemo(() => toDisplayMarkdown(value), [value]);
  const body = useResolveClassNames('text-base leading-6 text-foreground');
  const foreground = useResolveClassNames('text-foreground');
  const code = useResolveClassNames('rounded-lg bg-default p-2 font-mono text-sm text-foreground');
  const quote = useResolveClassNames('border-l-2 border-navigation-active bg-default/40 py-2 pl-3');
  const link = useResolveClassNames('text-navigation-active underline');
  const border = useResolveClassNames('border-border');
  const rule = useResolveClassNames('bg-border');
  const tableHeader = useResolveClassNames('bg-default');
  const blockSpacing = useResolveClassNames('mt-0 mb-2');
  const styles = useMemo(
    () => ({
      text: body,
      codeInline: code,
      codeBlock: code,
      inlineCode: code,
      heading: foreground,
      headingContainer: blockSpacing,
      paragraph: blockSpacing,
      listUnorderedItemIcon: foreground,
      listOrderedItemIcon: foreground,
      blockquote: quote,
      link,
      blocklink: border,
      table: border,
      tableRow: border,
      tableRowCell: border,
      tableHeaderCell: border,
      tableHeader,
      heading1Container: border,
      heading2Container: border,
      hr: rule,
    }),
    [body, border, code, foreground, link, quote, rule, tableHeader, blockSpacing],
  );

  return (
    <Markdown
      markdownit={parser}
      style={styles}
      allowedImageHandlers={ImageHandlers}
      defaultImageHandler={null}
      onLinkPress={(href) => {
        const url = markdownLink(href);
        if (url) {
          void (async () => {
            try {
              await (onLinkPress ?? Linking.openURL)(url);
            } catch (error) {
              onLinkError?.(error);
            }
          })();
        }
        return false;
      }}>
      {markdown}
    </Markdown>
  );
}
