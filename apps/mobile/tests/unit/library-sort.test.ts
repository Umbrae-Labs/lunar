import { describe, expect, it } from 'vitest';

import {
  sortLibraryBooks,
} from '../../src/features/library/domain/library-sort';
import {
  type LibrarySort,
} from '../../src/stores/library-store';

type TestBook = {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly addedAt: number;
  readonly lastOpenedAt?: number;
};

const books: readonly TestBook[] = [
  { id: '1', title: 'Book 10', author: 'Carol', addedAt: 100, lastOpenedAt: 500 },
  { id: '2', title: 'Book 2', author: 'Alice', addedAt: 300 },
  { id: '3', title: 'alpha', author: 'Bob', addedAt: 200, lastOpenedAt: 400 },
];

describe('sortLibraryBooks', () => {
  it('defaults to recently read in descending order', () => {
    const defaultSort: LibrarySort = {
      field: 'recentlyRead',
      direction: 'descending',
    };

    expect(ids(sortLibraryBooks(books, defaultSort, 'en'))).toEqual(['1', '3', '2']);
  });

  it.each([
    [{ field: 'addedAt', direction: 'ascending' }, ['1', '3', '2']],
    [{ field: 'addedAt', direction: 'descending' }, ['2', '3', '1']],
    [{ field: 'title', direction: 'ascending' }, ['3', '2', '1']],
    [{ field: 'title', direction: 'descending' }, ['1', '2', '3']],
    [{ field: 'author', direction: 'ascending' }, ['2', '3', '1']],
    [{ field: 'author', direction: 'descending' }, ['1', '3', '2']],
  ] satisfies readonly (readonly [LibrarySort, readonly string[]])[])(
    'sorts with $field in $direction order',
    (sort, expectedIds) => {
      expect(ids(sortLibraryBooks(books, sort, 'en'))).toEqual(expectedIds);
    },
  );

  it('does not mutate the source array', () => {
    const source = [...books];

    sortLibraryBooks(source, { field: 'title', direction: 'ascending' }, 'en');

    expect(ids(source)).toEqual(['1', '2', '3']);
  });
});

function ids(sortedBooks: readonly TestBook[]): readonly string[] {
  return sortedBooks.map((book) => book.id);
}
