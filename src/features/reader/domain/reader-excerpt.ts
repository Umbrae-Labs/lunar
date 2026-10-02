/** A frozen selection snapshot; opening the editor never changes a saved mark. */
export interface ReaderExcerpt {
  readonly text: string;
  readonly bookTitle: string;
  readonly author?: string;
  readonly chapterTitle?: string;
  readonly createdAt: number;
}
