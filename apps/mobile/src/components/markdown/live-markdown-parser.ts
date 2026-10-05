import { parseExpensiMark, type MarkdownRange } from '@expensify/react-native-live-markdown';

/** Extend the native editor's single heading style to Markdown heading levels 2–6. */
export function parseLiveMarkdown(input: string, maxLength = input.length): MarkdownRange[] {
  'worklet';
  if (input.length > maxLength) return [];
  const ranges = parseExpensiMark(input, maxLength);
  const protectedRanges = ranges.filter((range) =>
    ['code', 'pre', 'codeblock', 'link', 'inline-image'].includes(range.type),
  );
  const headings = /^#{2,6}[ \t]+(?=\S)([^\r\n]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = headings.exec(input)) !== null) {
    const start = match.index;
    if (protectedRanges.some((range) => start >= range.start && start < range.start + range.length)) continue;
    const prefixLength = match[0].length - match[1].length;
    ranges.push(
      { type: 'syntax', start, length: prefixLength },
      { type: 'h1', start: start + prefixLength, length: match[1].length },
    );
  }
  // Apply the heading before inline emphasis at the same location.
  return ranges.sort(
    (a, b) => a.start - b.start || b.length - a.length || Number(b.type === 'h1') - Number(a.type === 'h1'),
  );
}
