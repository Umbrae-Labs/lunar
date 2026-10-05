export const LIBRARY_GRID_COLUMNS = 3;
export const LIBRARY_GRID_HORIZONTAL_PADDING = 10;
export const LIBRARY_GRID_TOP_PADDING = 8;
export const BOOK_CARD_HORIZONTAL_PADDING = 6;
export const BOOK_CARD_COVER_ASPECT_RATIO = 2 / 3;
export const BOOK_CARD_DETAILS_HEIGHT = 38;
export const BOOK_CARD_BOTTOM_MARGIN = 24;
export const LIBRARY_GRID_AUTO_SCROLL_EDGE_SIZE = 72;
export const LIBRARY_GRID_AUTO_SCROLL_MAX_SPEED = 640;

interface GridPoint {
  readonly x: number;
  readonly y: number;
}

interface GridSelectionSessionOptions {
  readonly itemIds: readonly (string | undefined)[];
  readonly scrollOffset: number;
  readonly viewportWidth: number;
  readonly windowOriginX: number;
  readonly windowOriginY: number;
}

interface LibraryGridHitTestOptions {
  readonly itemCount: number;
  readonly scrollOffset: number;
  readonly viewportWidth: number;
}

interface LibraryGridEdgeScrollOptions {
  readonly obscuredBottomHeight: number;
  readonly viewportHeight: number;
  readonly windowOriginY: number;
}

export interface LibraryGridEdgeScrollState {
  readonly scrollVelocity: number;
  readonly selectionWindowY: number;
}

export function resolveLibraryGridEdgeScroll(
  windowY: number,
  options: LibraryGridEdgeScrollOptions,
): LibraryGridEdgeScrollState {
  const viewportTop = options.windowOriginY;
  const viewportBottom = Math.max(viewportTop, viewportTop + options.viewportHeight - options.obscuredBottomHeight);
  if (viewportBottom <= viewportTop) {
    return { scrollVelocity: 0, selectionWindowY: windowY };
  }

  const topStrength = clamp(
    (viewportTop + LIBRARY_GRID_AUTO_SCROLL_EDGE_SIZE - windowY) / LIBRARY_GRID_AUTO_SCROLL_EDGE_SIZE,
    0,
    1,
  );
  const bottomStrength = clamp(
    (windowY - (viewportBottom - LIBRARY_GRID_AUTO_SCROLL_EDGE_SIZE)) / LIBRARY_GRID_AUTO_SCROLL_EDGE_SIZE,
    0,
    1,
  );
  const scrollVelocity =
    topStrength > bottomStrength
      ? -LIBRARY_GRID_AUTO_SCROLL_MAX_SPEED * topStrength
      : LIBRARY_GRID_AUTO_SCROLL_MAX_SPEED * bottomStrength;

  return {
    scrollVelocity,
    selectionWindowY: clamp(windowY, viewportTop, viewportBottom - 1),
  };
}

export function libraryItemIndexAtPoint(point: GridPoint, options: LibraryGridHitTestOptions): number | undefined {
  const contentWidth = options.viewportWidth - LIBRARY_GRID_HORIZONTAL_PADDING * 2;
  if (contentWidth <= 0) {
    return undefined;
  }

  const contentX = point.x - LIBRARY_GRID_HORIZONTAL_PADDING;
  if (contentX < 0 || contentX >= contentWidth) {
    return undefined;
  }

  const contentY = point.y + options.scrollOffset - LIBRARY_GRID_TOP_PADDING;
  if (contentY < 0) {
    return undefined;
  }

  const columnWidth = contentWidth / LIBRARY_GRID_COLUMNS;
  const coverWidth = columnWidth - BOOK_CARD_HORIZONTAL_PADDING * 2;
  const rowHeight = coverWidth / BOOK_CARD_COVER_ASPECT_RATIO + BOOK_CARD_DETAILS_HEIGHT + BOOK_CARD_BOTTOM_MARGIN;
  const column = Math.min(LIBRARY_GRID_COLUMNS - 1, Math.floor(contentX / columnWidth));
  const row = Math.floor(contentY / rowHeight);
  const index = row * LIBRARY_GRID_COLUMNS + column;

  return index < options.itemCount ? index : undefined;
}

export function inclusiveIndexRange(from: number, to: number): readonly number[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

export class LibraryGridSelectionSession {
  private itemIds: readonly (string | undefined)[] = [];
  private scrollOffset = 0;
  private viewportWidth = 0;
  private windowOriginX = 0;
  private windowOriginY = 0;
  private lastIndex: number | undefined;
  private readonly visitedBookIds = new Set<string>();

  update(options: Partial<GridSelectionSessionOptions>): void {
    if (options.itemIds !== undefined) {
      this.itemIds = options.itemIds;
    }
    if (options.scrollOffset !== undefined) {
      this.scrollOffset = options.scrollOffset;
    }
    if (options.viewportWidth !== undefined) {
      this.viewportWidth = options.viewportWidth;
    }
    if (options.windowOriginX !== undefined) {
      this.windowOriginX = options.windowOriginX;
    }
    if (options.windowOriginY !== undefined) {
      this.windowOriginY = options.windowOriginY;
    }
  }

  beginFromWindow(point: GridPoint): readonly string[] {
    return this.begin(this.toLocalPoint(point));
  }

  continueFromWindow(point: GridPoint): readonly string[] {
    return this.continue(this.toLocalPoint(point));
  }

  begin(point: GridPoint): readonly string[] {
    this.lastIndex = undefined;
    this.visitedBookIds.clear();
    return this.visit(point);
  }

  continue(point: GridPoint): readonly string[] {
    return this.visit(point);
  }

  finish(): void {
    this.lastIndex = undefined;
    this.visitedBookIds.clear();
  }

  private toLocalPoint(point: GridPoint): GridPoint {
    return {
      x: point.x - this.windowOriginX,
      y: point.y - this.windowOriginY,
    };
  }

  private visit(point: GridPoint): readonly string[] {
    const hitIndex = libraryItemIndexAtPoint(point, {
      itemCount: this.itemIds.length,
      scrollOffset: this.scrollOffset,
      viewportWidth: this.viewportWidth,
    });
    if (hitIndex === undefined) {
      return [];
    }

    const previousIndex = this.lastIndex ?? hitIndex;
    this.lastIndex = hitIndex;
    return inclusiveIndexRange(previousIndex, hitIndex).flatMap((index) => {
      const bookId = this.itemIds[index];
      if (bookId === undefined || this.visitedBookIds.has(bookId)) {
        return [];
      }
      this.visitedBookIds.add(bookId);
      return [bookId];
    });
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
