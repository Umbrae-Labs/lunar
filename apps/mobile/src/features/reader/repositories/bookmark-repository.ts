import type { ReaderBookmark } from '../domain/reader-bookmark';

export interface BookmarkRepository {
  listByBookId(bookId: string): Promise<readonly ReaderBookmark[]>;
  save(bookmark: ReaderBookmark): Promise<ReaderBookmark>;
  remove(bookId: string, id: string): Promise<void>;
}
