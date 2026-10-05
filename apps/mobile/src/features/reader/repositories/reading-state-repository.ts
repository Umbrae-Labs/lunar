import type { ReaderReadingState } from '../domain/reader-reading-state';

export interface ReadingStateRepository {
  findByBookId(bookId: string): Promise<ReaderReadingState | undefined>;
  findMostRecentlyReadBookId(): Promise<string | undefined>;
  save(state: ReaderReadingState): Promise<void>;
  remove(bookId: string): Promise<void>;
}
