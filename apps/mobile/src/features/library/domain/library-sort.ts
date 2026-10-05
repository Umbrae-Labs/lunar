import type { LibrarySort, LibrarySortField } from '@/stores';

type SortableLibraryBook = {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly addedAt: number;
  readonly lastOpenedAt?: number;
};

export function sortLibraryBooks<Book extends SortableLibraryBook>(
  books: readonly Book[],
  sort: LibrarySort,
  locale?: string,
): readonly Book[] {
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: 'base',
  });
  const direction = sort.direction === 'ascending' ? 1 : -1;

  return [...books].sort((left, right) => {
    const primaryComparison = compareByField(left, right, sort.field, collator);
    if (primaryComparison !== 0) {
      return primaryComparison * direction;
    }

    return (
      collator.compare(left.title, right.title) ||
      collator.compare(left.author, right.author) ||
      left.addedAt - right.addedAt ||
      collator.compare(left.id, right.id)
    );
  });
}

function compareByField(
  left: SortableLibraryBook,
  right: SortableLibraryBook,
  field: LibrarySortField,
  collator: Intl.Collator,
): number {
  switch (field) {
    case 'addedAt':
      return left.addedAt - right.addedAt;
    case 'recentlyRead':
      return (left.lastOpenedAt ?? left.addedAt) - (right.lastOpenedAt ?? right.addedAt);
    case 'title':
      return collator.compare(left.title, right.title);
    case 'author':
      return collator.compare(left.author, right.author);
  }
}
