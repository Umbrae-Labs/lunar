import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { DATABASE_MIGRATIONS, LUNAR_DATABASE_NAME } from './migrations';

interface UserVersionRow {
  readonly user_version: number;
}

let databasePromise: Promise<SQLiteDatabase> | undefined;

export function getLunarDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = initializeLunarDatabase().catch((error: unknown) => {
      databasePromise = undefined;
      throw error;
    });
  }

  return databasePromise;
}

async function initializeLunarDatabase(): Promise<SQLiteDatabase> {
  const database = await openDatabaseAsync(LUNAR_DATABASE_NAME);
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);
  await migrateDatabase(database);
  return database;
}

export async function migrateDatabase(database: SQLiteDatabase): Promise<void> {
  const row = await database.getFirstAsync<UserVersionRow>('PRAGMA user_version');
  let currentVersion = row?.user_version ?? 0;

  for (const migration of DATABASE_MIGRATIONS) {
    if (migration.version <= currentVersion) {
      continue;
    }

    await database.withExclusiveTransactionAsync(async (transaction) => {
      for (const statement of migration.statements) {
        await transaction.execAsync(statement);
      }
      await transaction.execAsync(`PRAGMA user_version = ${migration.version}`);
    });
    currentVersion = migration.version;
  }

  // Older installations may already report v2 while lacking the extracted
  // asset index. Create it after the books table and migrations exist.
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await transaction.execAsync(
      `CREATE TABLE IF NOT EXISTS book_assets (
        book_id TEXT NOT NULL,
        path TEXT NOT NULL,
        uri TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        sha256 TEXT,
        PRIMARY KEY (book_id, path),
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      )`,
    );
    await transaction.execAsync('CREATE INDEX IF NOT EXISTS book_assets_book_id_index ON book_assets(book_id)');
  });
}
