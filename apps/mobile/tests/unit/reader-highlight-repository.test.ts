import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { DATABASE_MIGRATIONS } from '../../src/db/migrations';
import type { ReaderHighlight } from '../../src/features/reader/domain/reader-highlight';
import { SQLiteHighlightRepository } from '../../src/features/reader/repositories/sqlite-highlight-repository';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function createDatabase(version = 9) {
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
    getAllAsync: async (sql: string, ...params: SQLInputValue[]) => sqlite.prepare(sql).all(...params),
    runAsync: async (sql: string, ...params: SQLInputValue[]) => sqlite.prepare(sql).run(...params),
    withExclusiveTransactionAsync: async (callback: (transaction: SQLiteDatabase) => Promise<void>) => {
      sqlite.exec('BEGIN');
      try {
        await callback(adapter as unknown as SQLiteDatabase);
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, repository: new SQLiteHighlightRepository(adapter as unknown as SQLiteDatabase) };
}

const highlight: ReaderHighlight = {
  id: 'highlight', bookId: 'book', href: 'chapter.xhtml', text: 'text', createdAt: 1,
  sourceRange: { start: { nodePath: [1], textOffset: 0 }, end: { nodePath: [1], textOffset: 4 } },
};

describe('SQLite highlight persistence', () => {
  it('migrates version seven annotations without changing their appearance or source', async () => {
    const { sqlite, repository } = createDatabase(7);
    sqlite.prepare('INSERT INTO reader_highlights VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      highlight.id, highlight.bookId, highlight.href, JSON.stringify(highlight.sourceRange), highlight.text,
      highlight.createdAt, 'pink', 'wavy',
    );
    for (const migration of DATABASE_MIGRATIONS.filter((item) => item.version > 7)) {
      for (const statement of migration.statements) sqlite.exec(statement);
    }
    expect(await repository.listByBookId('book')).toEqual([{ ...highlight, color: 'pink', style: 'wavy' }]);
  });

  it('preserves Markdown exactly, edits only the owning note and deletes it independently of the mark', async () => {
    const { repository } = createDatabase();
    const note = { id: 'n1', content: '## 想法\n\n**重要**\n\n```ts\nconst x = 1;\n```', createdAt: 1, updatedAt: 1 };
    const second = { ...note, id: 'n2' };
    const stored = { ...highlight, color: 'purple' as const, style: 'underline' as const, notes: [note, second] };
    await repository.save(stored);
    expect(await repository.listByBookId('book')).toEqual([stored]);
    await expect(repository.updateNotes('other', highlight.id, [])).rejects.toThrow();
    expect(await repository.listByBookId('book')).toEqual([stored]);
    const updated = { ...note, content: note.content + '\n修改', updatedAt: 2 };
    await repository.updateNotes('book', highlight.id, [updated, second]);
    expect(await repository.listByBookId('book')).toEqual([{ ...stored, notes: [updated, second] }]);
    await repository.updateNotes('book', highlight.id, [second]);
    expect(await repository.listByBookId('book')).toEqual([{ ...stored, notes: [second] }]);
    await repository.updateNotes('book', highlight.id, []);
    expect(await repository.listByBookId('book')).toEqual([{ ...highlight, color: 'purple', style: 'underline' }]);
  });
  it('migrates existing records to yellow without losing their ranges or text', async () => {
    const { sqlite, repository } = createDatabase(3);
    sqlite.prepare('INSERT INTO reader_highlights VALUES (?, ?, ?, ?, ?, ?)').run(
      highlight.id, highlight.bookId, highlight.href, JSON.stringify(highlight.sourceRange), highlight.text, highlight.createdAt,
    );
    for (const migration of DATABASE_MIGRATIONS.filter((item) => item.version > 3)) {
      for (const statement of migration.statements) sqlite.exec(statement);
    }
    expect(await repository.listByBookId('book')).toEqual([{ ...highlight, color: 'yellow', style: 'highlight' }]);
  });

  it('persists color edits and atomically replaces overlapping records', async () => {
    const { repository } = createDatabase();
    await repository.save(highlight);
    const updated = { ...highlight, color: 'green' as const, text: 'expanded', sourceRange: { ...highlight.sourceRange, end: { nodePath: [1], textOffset: 8 } } };
    await repository.replace(updated, [highlight.id]);
    expect(await repository.listByBookId('book')).toEqual([{ ...updated, style: 'highlight' }]);
    await repository.remove('book', [highlight.id]);
    expect(await repository.listByBookId('book')).toEqual([]);
  });

  it('rolls back deletion if saving the replacement fails', async () => {
    const { repository } = createDatabase();
    await repository.save(highlight);
    await expect(repository.replace({ ...highlight, text: null as unknown as string }, [highlight.id])).rejects.toThrow();
    expect(await repository.listByBookId('book')).toEqual([{ ...highlight, color: 'yellow', style: 'highlight' }]);
  });

  it('scopes deletions to the owning book', async () => {
    const { repository } = createDatabase();
    await repository.save(highlight);
    await repository.remove('other', [highlight.id]);
    expect(await repository.listByBookId('book')).toHaveLength(1);
  });

  it('retains unique range enforcement and validates stored colors', async () => {
    const { sqlite, repository } = createDatabase();
    await repository.save(highlight);
    await repository.save({ ...highlight, id: 'replacement', color: 'purple' });
    expect(await repository.listByBookId('book')).toHaveLength(1);
    sqlite.exec("UPDATE reader_highlights SET color = 'invalid'");
    expect((await repository.listByBookId('book'))[0].color).toBe('yellow');
  });

  it.each(['highlight', 'underline', 'wavy'] as const)('round trips the %s style independently of color', async (style) => {
    const { sqlite, repository } = createDatabase();
    await repository.save({ ...highlight, color: 'pink', style });
    expect(await repository.listByBookId('book')).toEqual([{ ...highlight, color: 'pink', style }]);
    await repository.save({ ...highlight, color: 'blue', style });
    expect((await repository.listByBookId('book'))[0]).toMatchObject({ color: 'blue', style });
    sqlite.exec("UPDATE reader_highlights SET style = 'invalid'");
    expect((await repository.listByBookId('book'))[0].style).toBe('highlight');
  });
});
