import type { LibraryBookRecord } from '../domain/library-book';

export interface BookRepository {
  save(book: LibraryBookRecord): Promise<void>;
  findById(id: string): Promise<LibraryBookRecord | undefined>;
  findBySha256(sha256: string): Promise<LibraryBookRecord | undefined>;
  list(): Promise<readonly LibraryBookRecord[]>;
  remove(id: string): Promise<void>;
}
