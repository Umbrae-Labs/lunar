import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { ReaderRenderFrame, ReaderSnapshot } from '../../src/reader';
import { afterEach, describe, expect, it } from 'vitest';
import { DATABASE_MIGRATIONS } from '../../src/db/migrations';
import { bookmarkLocationKey, hasBookmarkOnRenderedPage, isBookmarkOnPage, parseBookmarkLocator, type ReaderBookmark } from '../../src/features/reader/domain/reader-bookmark';
import { SQLiteBookmarkRepository } from '../../src/features/reader/repositories/sqlite-bookmark-repository';
import { bookmarkPullDistance, shouldSavePulledBookmark } from '../../src/features/reader/domain/bookmark-pull';
import { toRitoSavedLocator } from '../../src/reader/rito/saved-locator';
import { readerBookmarkPlacement, readerBookmarkPullHeight, readerBookmarkPullPhase } from '../../src/reader/skia/rendering/reader-bookmark-geometry';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const bookmark: ReaderBookmark = {
  id: 'mark', bookId: 'book', locator: { spineIdref: 'chapter', manifestHref: 'text/chapter.xhtml', chapterProgress: 0.4,
    sourcePoint: { nodePath: [1, 2], textOffset: 7 } }, label: 'Chapter', text: 'saved passage', createdAt: 100,
};

function database(version = 5) {
  const sqlite = new DatabaseSync(':memory:');
  databases.push(sqlite);
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of DATABASE_MIGRATIONS.filter((item) => item.version <= version)) {
    for (const statement of migration.statements) sqlite.exec(statement);
  }
  for (const id of ['book', 'other']) sqlite.prepare(`INSERT INTO books
    (id, title, epub_identifier, file_uri, file_name, file_size, sha256, added_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, 1, 1)`).run(id, id, id, id, id, id);
  const adapter = {
    getAllAsync: async (sql: string, ...args: SQLInputValue[]) => sqlite.prepare(sql).all(...args),
    runAsync: async (sql: string, ...args: SQLInputValue[]) => sqlite.prepare(sql).run(...args),
    withExclusiveTransactionAsync: async (callback: (transaction: SQLiteDatabase) => Promise<void>) => {
      sqlite.exec('BEGIN');
      try { await callback(adapter as unknown as SQLiteDatabase); sqlite.exec('COMMIT'); }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return { sqlite, adapter: adapter as unknown as SQLiteDatabase, repository: new SQLiteBookmarkRepository(adapter as unknown as SQLiteDatabase) };
}

describe('reader bookmark persistence', () => {
  it('keeps pre-existing bookmarks when adding excerpt storage', async () => {
    const { sqlite, repository } = database(4);
    sqlite.prepare('INSERT INTO bookmarks VALUES (?, ?, ?, ?, ?)').run(bookmark.id, bookmark.bookId, JSON.stringify(bookmark.locator), bookmark.label, bookmark.createdAt);
    for (const sql of DATABASE_MIGRATIONS[4].statements) sqlite.exec(sql);
    expect(await repository.listByBookId('book')).toEqual([{ ...bookmark, text: '' }]);
  });

  it('restores source coordinates and excerpts in a new repository instance', async () => {
    const { repository, adapter } = database();
    await repository.save(bookmark);
    expect(await new SQLiteBookmarkRepository(adapter).listByBookId('book')).toEqual([bookmark]);
  });

  it('deduplicates the same source point despite changed pagination progress', async () => {
    const { repository } = database();
    await repository.save(bookmark);
    expect(await repository.save({ ...bookmark, id: 'duplicate', locator: { ...bookmark.locator, chapterProgress: 0.7 } })).toEqual(bookmark);
    expect(await repository.listByBookId('book')).toHaveLength(1);
    await repository.save({ ...bookmark, id: 'next', locator: { ...bookmark.locator, sourcePoint: { nodePath: [1, 2], textOffset: 8 } } });
    expect(await repository.listByBookId('book')).toHaveLength(2);
  });

  it('isolates books and cascades book deletion', async () => {
    const { repository, sqlite } = database();
    await repository.save(bookmark);
    await repository.save({ ...bookmark, id: 'other-mark', bookId: 'other' });
    await repository.remove('other', bookmark.id);
    expect(await repository.listByBookId('book')).toHaveLength(1);
    sqlite.prepare('DELETE FROM books WHERE id = ?').run('book');
    expect(await repository.listByBookId('book')).toEqual([]);
    expect(await repository.listByBookId('other')).toHaveLength(1);
    await repository.remove('other', 'other-mark');
    expect(await repository.listByBookId('other')).toEqual([]);
  });

  it('ignores malformed locators while retaining valid records', async () => {
    const { repository, sqlite } = database();
    await repository.save(bookmark);
    sqlite.prepare('INSERT INTO bookmarks (id, book_id, locator_json, created_at) VALUES (?, ?, ?, ?)').run('bad', 'book', '{', 200);
    expect(await repository.listByBookId('book')).toEqual([bookmark]);
    expect(parseBookmarkLocator(JSON.stringify({ ...bookmark.locator, sourcePoint: { nodePath: [-1], textOffset: 0 } }))).toBeUndefined();
  });
});

describe('bookmark gestures and source locations', () => {
  it('shows the pull hint immediately and switches its arrow at the commit distance', () => {
    expect(readerBookmarkPullPhase(0, 96)).toBe('idle');
    expect(readerBookmarkPullPhase(1, 96)).toBe('pulling');
    expect(readerBookmarkPullPhase(95, 96)).toBe('pulling');
    expect(readerBookmarkPullPhase(96, 96)).toBe('ready');
  });

  it('extends the bookmark from the safe area to above the first text line', () => {
    const frame = { width: 560, hits: [{ bounds: { x: 40, y: 140, width: 200, height: 25 } }] } as ReaderRenderFrame;
    const placement = readerBookmarkPlacement(frame, 1, 0, 0, 40);
    expect(placement.x).toBe(528);
    expect(placement.height).toBe(132);
    expect(readerBookmarkPullHeight(placement.height, 90)).toBe(132);
    expect(readerBookmarkPullHeight(placement.height, 160)).toBe(160);
  });

  it('saves only when a successful release remains over the threshold', () => {
    expect(shouldSavePulledBookmark(159, true)).toBe(false);
    expect(shouldSavePulledBookmark(160, true)).toBe(true);
    expect(shouldSavePulledBookmark(240, false)).toBe(false);
    expect(shouldSavePulledBookmark(-160, true)).toBe(false);
    // Pull above the threshold and then retreat before releasing.
    expect(bookmarkPullDistance(240)).toBeGreaterThan(96);
    expect(shouldSavePulledBookmark(80, true)).toBe(false);
    expect(bookmarkPullDistance(1000)).toBe(164);
  });

  it('recognizes a bookmark inside the new page after typography changes', () => {
    const entries = [{ pageIndex: 30, bounds: { x: 0, y: 0, width: 100, height: 20 }, text: '0123456789', sourcePoint: { nodePath: [1, 2], textOffset: 3 } }];
    const locator = { ...bookmark.locator, chapterProgress: 0.8, sourcePoint: { nodePath: [1, 2], textOffset: 3 } };
    expect(isBookmarkOnPage(bookmark, locator, entries)).toBe(true);
    expect(isBookmarkOnPage(bookmark, locator, [{ ...entries[0], text: '', sourcePoint: bookmark.locator.sourcePoint }])).toBe(true);
    expect(isBookmarkOnPage(bookmark, locator, [{ ...entries[0], text: bookmark.text, sourcePoint: undefined }])).toBe(true);
    expect(isBookmarkOnPage(bookmark, { ...locator, manifestHref: 'other.xhtml' }, entries)).toBe(false);
    expect(isBookmarkOnPage(bookmark, locator, [{ ...entries[0], text: '0123' }])).toBe(false);
  });

  it('places the bookmark on its own page when neighboring pages turn', () => {
    const point = { nodePath: [1, 2], textOffset: 3 };
    const snapshot = { position: { locator: bookmark.locator } } as ReaderSnapshot;
    const markedFrame = { hits: [{ pageIndex: 30, bounds: { x: 0, y: 0, width: 100, height: 20 },
      text: '0123456789', sourcePoint: point }] } as ReaderRenderFrame;
    const nextFrame = { hits: [{ ...markedFrame.hits![0], text: 'next page',
      sourcePoint: { nodePath: [1, 2], textOffset: 20 } }] } as ReaderRenderFrame;
    expect(hasBookmarkOnRenderedPage([bookmark], snapshot, markedFrame)).toBe(true);
    expect(hasBookmarkOnRenderedPage([bookmark], snapshot, nextFrame)).toBe(false);
    expect(hasBookmarkOnRenderedPage([], snapshot, markedFrame)).toBe(false);
  });

  it('uses UTF-16 source coordinates for bookmarks and highlight jumps', () => {
    const range = { start: { nodePath: [1, 2], textOffset: 7 }, end: { nodePath: [1, 3], textOffset: 14 } };
    const locator = { ...bookmark.locator, sourcePoint: undefined, sourceRange: range, anchorId: 'old-anchor' };
    expect(bookmarkLocationKey(locator)).toBe(bookmarkLocationKey(bookmark.locator));
    expect(toRitoSavedLocator(locator, 'text/chapter.xhtml')).toEqual({
      href: 'text/chapter.xhtml', anchorId: undefined, progression: undefined,
      sourcePoint: { nodePath: [1, 2], textOffset: 7n },
    });
  });
});
