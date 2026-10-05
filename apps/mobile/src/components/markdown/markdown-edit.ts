export const MarkdownFormats = [
  'bold',
  'italic',
  'strikethrough',
  'code',
  'heading',
  'quote',
  'codeBlock',
  'link',
] as const;
export type MarkdownFormat = (typeof MarkdownFormats)[number];
export interface MarkdownSelection {
  readonly start: number;
  readonly end: number;
}
export interface MarkdownEdit {
  readonly value: string;
  readonly selection: MarkdownSelection;
}

/** The Live Markdown callback is pure: the library commits its returned text. */
export function formatMarkdownSelection(text: string, start: number, end: number, command: string, maxLength?: number) {
  const format = command === 'formatBold' ? 'bold' : command === 'formatItalic' ? 'italic' : undefined;
  const edit = format
    ? formatMarkdown(text, { start, end }, format, maxLength)
    : { value: text, selection: { start, end } };
  return {
    updatedText: edit.value,
    // Web format commands collapse after newly inserted syntax; removing syntax
    // follows the adjusted selection end, including an enclosing selection.
    cursorOffset: edit.value.length > text.length ? edit.value.length - text.length : edit.selection.end - end,
    selection: edit.selection,
  };
}

/** UTF-16 offsets match the native input, including Chinese and emoji selections. */
export function formatMarkdown(
  value: string,
  selection: MarkdownSelection,
  format: MarkdownFormat,
  maxLength?: number,
): MarkdownEdit {
  const start = Math.max(0, Math.min(selection.start, selection.end, value.length));
  const end = Math.max(start, Math.min(Math.max(selection.start, selection.end), value.length));
  const selected = value.slice(start, end);
  let edit: MarkdownEdit;
  if (format === 'heading' || format === 'quote') {
    const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
    const nextLine = value.indexOf('\n', end > start ? end - 1 : end);
    const lineEnd = nextLine < 0 ? value.length : nextLine;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const prefix = format === 'heading' ? /^(#{1,6})[ \t]+/ : /^(>)[ \t]?/;
    const level = format === 'heading' ? (lines[0].match(prefix)?.[1].length ?? 0) : 0;
    const replacement =
      format === 'heading'
        ? level === 6
          ? ''
          : `${'#'.repeat(level + 1)} `
        : lines.every((line) => prefix.test(line))
          ? ''
          : '> ';
    let offset = lineStart;
    let mappedStart = start;
    let mappedEnd = end;
    const updated = lines
      .map((line) => {
        const removed = line.match(prefix)?.[0].length ?? 0;
        const delta = replacement.length - removed;
        if (start >= offset) mappedStart += start >= offset + removed ? delta : replacement.length - (start - offset);
        if (end >= offset) mappedEnd += end >= offset + removed ? delta : replacement.length - (end - offset);
        offset += line.length + 1;
        return replacement + line.slice(removed);
      })
      .join('\n');
    edit = {
      value: value.slice(0, lineStart) + updated + value.slice(lineEnd),
      selection: { start: mappedStart, end: mappedEnd },
    };
  } else if (format === 'link') {
    const insertion = `[${selected}](https://)`;
    const caret = start + (selected ? selected.length + 3 : 1);
    edit = {
      value: value.slice(0, start) + insertion + value.slice(end),
      selection: { start: caret, end: caret + (selected ? 8 : 0) },
    };
  } else {
    const markers = { bold: '*', italic: '_', strikethrough: '~', code: '`', codeBlock: '```' };
    const marker = markers[format];
    const opening = format === 'codeBlock' ? `${marker}\n` : marker;
    const closing = format === 'codeBlock' ? `\n${marker}` : marker;
    if (
      selected.length >= opening.length + closing.length &&
      selected.startsWith(opening) &&
      selected.endsWith(closing)
    ) {
      const inner = selected.slice(opening.length, -closing.length);
      edit = {
        value: value.slice(0, start) + inner + value.slice(end),
        selection: { start, end: start + inner.length },
      };
    } else if (
      start >= opening.length &&
      value.slice(start - opening.length, start) === opening &&
      value.slice(end, end + closing.length) === closing
    ) {
      edit = {
        value: value.slice(0, start - opening.length) + selected + value.slice(end + closing.length),
        selection: { start: start - opening.length, end: end - opening.length },
      };
    } else {
      const before = format === 'codeBlock' && start > 0 && value[start - 1] !== '\n' ? '\n' : '';
      const after = format === 'codeBlock' && end < value.length && value[end] !== '\n' ? '\n' : '';
      const prefix = before + opening;
      edit = {
        value: value.slice(0, start) + prefix + selected + closing + after + value.slice(end),
        selection: { start: start + prefix.length, end: end + prefix.length },
      };
    }
  }
  return maxLength !== undefined && edit.value.length > maxLength ? { value, selection: { start, end } } : edit;
}
