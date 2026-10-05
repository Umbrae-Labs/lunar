import type { ReaderHighlight, ReaderNote } from '../domain/reader-highlight';

export interface HighlightRepository {
  listByBookId(bookId: string): Promise<readonly ReaderHighlight[]>;
  save(highlight: ReaderHighlight): Promise<void>;
  replace(highlight: ReaderHighlight, removedIds: readonly string[]): Promise<void>;
  remove(bookId: string, ids: readonly string[]): Promise<void>;
  updateNotes(bookId: string, id: string, notes: readonly ReaderNote[]): Promise<void>;
}
