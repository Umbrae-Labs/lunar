/**
 * Converts selection line breaks into natural display text.
 *
 * Selection ranges retain visual line boundaries for copying and source-range
 * matching. Cards and note previews need the destination width to decide where
 * lines end, so visual breaks inside a paragraph are joined here.
 */
export function normalizeReaderDisplayText(value: string): string {
  const paragraphs = value.replace(/\r\n?/gu, '\n').split(/\n{2,}/u);
  const display = paragraphs
    .map((paragraph) => {
      const lines = paragraph
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      return lines.reduce((joined, line, index) => {
        if (index === 0) return line;
        const previousCharacter = joined.at(-1) ?? '';
        const nextCharacter = line.at(0) ?? '';
        if (startsParagraph(lines[index - 1] ?? '', line)) return `${joined}\n\n${line}`;
        const separator =
          /[\u3400-\u9fff]/u.test(previousCharacter) || /[\u3400-\u9fff]/u.test(nextCharacter) ? '' : ' ';
        return `${joined}${separator}${line}`;
      }, '');
    })
    .filter(Boolean)
    .join('\n\n');

  return display.replace(/([\u3400-\u9fff，。！？；：、“”‘’（）《》【】]) +(?=[\u3400-\u9fff])/gu, '$1');
}

function startsParagraph(previousLine: string, currentLine: string): boolean {
  const previousCharacter = previousLine.trim().at(-1) ?? '';
  const currentCharacter = currentLine.trim().at(0) ?? '';
  return /[」』”’）)]/u.test(previousCharacter) || /^[「『“"'（(]/u.test(currentCharacter);
}
