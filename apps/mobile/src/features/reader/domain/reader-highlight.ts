import type { ReaderSourceRange } from '@/reader';

export const ReaderHighlightColors = ['yellow', 'pink', 'purple', 'blue', 'green'] as const;
export type ReaderHighlightColor = (typeof ReaderHighlightColors)[number];
export const ReaderHighlightStyles = ['highlight', 'underline', 'wavy'] as const;
export type ReaderHighlightStyle = (typeof ReaderHighlightStyles)[number];

export const ReaderNoteMaxLength = 20000;

export interface ReaderNote {
  readonly id: string;
  readonly content: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ReaderHighlight {
  readonly id: string;
  readonly bookId: string;
  readonly href: string;
  readonly sourceRange: ReaderSourceRange;
  readonly text: string;
  readonly createdAt: number;
  readonly color?: ReaderHighlightColor;
  readonly style?: ReaderHighlightStyle;
  /** User-authored Markdown associated with the complete source range. */
  readonly notes?: readonly ReaderNote[];
}
