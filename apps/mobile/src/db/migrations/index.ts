export const LUNAR_DATABASE_NAME = 'lunar.db';

export interface DatabaseMigration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    name: 'create_library',
    statements: [
      `CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        language TEXT,
        epub_identifier TEXT NOT NULL,
        publisher TEXT,
        description TEXT,
        file_uri TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL CHECK (file_size >= 0),
        sha256 TEXT NOT NULL,
        cover_uri TEXT,
        added_at INTEGER NOT NULL,
        last_opened_at INTEGER,
        updated_at INTEGER NOT NULL
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS books_sha256_unique ON books(sha256)',
      `CREATE TABLE IF NOT EXISTS reading_states (
        book_id TEXT PRIMARY KEY NOT NULL,
        locator_json TEXT NOT NULL,
        fallback_progression REAL NOT NULL DEFAULT 0,
        current_page INTEGER,
        total_pages INTEGER,
        typography_json TEXT NOT NULL,
        theme TEXT NOT NULL,
        rito_version TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS bookmarks (
        id TEXT PRIMARY KEY NOT NULL,
        book_id TEXT NOT NULL,
        locator_json TEXT NOT NULL,
        label TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      )`,
      'CREATE INDEX IF NOT EXISTS bookmarks_book_id_index ON bookmarks(book_id)',
    ],
  },
  {
    version: 2,
    name: 'track_imported_metadata_version',
    statements: [
      'ALTER TABLE books ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 1',
      `CREATE TABLE IF NOT EXISTS book_assets (
        book_id TEXT NOT NULL,
        path TEXT NOT NULL,
        uri TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        sha256 TEXT,
        PRIMARY KEY (book_id, path),
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      )`,
      'CREATE INDEX IF NOT EXISTS book_assets_book_id_index ON book_assets(book_id)',
    ],
  },
  {
    version: 3,
    name: 'create_reader_highlights',
    statements: [
      `CREATE TABLE IF NOT EXISTS reader_highlights (
        id TEXT PRIMARY KEY NOT NULL,
        book_id TEXT NOT NULL,
        href TEXT NOT NULL,
        source_range_json TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(book_id, href, source_range_json),
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      )`,
      'CREATE INDEX IF NOT EXISTS reader_highlights_book_id_index ON reader_highlights(book_id)',
    ],
  },
  {
    version: 4,
    name: 'reader_highlight_colors',
    statements: ["ALTER TABLE reader_highlights ADD COLUMN color TEXT NOT NULL DEFAULT 'yellow'"],
  },
  {
    version: 5,
    name: 'bookmark_excerpts',
    statements: ["ALTER TABLE bookmarks ADD COLUMN text TEXT NOT NULL DEFAULT ''"],
  },
  {
    version: 6,
    name: 'reading_sessions',
    statements: [
      `CREATE TABLE IF NOT EXISTS reading_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        book_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL CHECK (ended_at >= started_at),
        time_zone TEXT NOT NULL,
        FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
      )`,
      'CREATE INDEX IF NOT EXISTS reading_sessions_book_time_index ON reading_sessions(book_id, started_at)',
    ],
  },
  {
    version: 7,
    name: 'reader_highlight_styles',
    statements: ["ALTER TABLE reader_highlights ADD COLUMN style TEXT NOT NULL DEFAULT 'highlight'"],
  },
  {
    version: 8,
    name: 'reader_highlight_notes',
    statements: ["ALTER TABLE reader_highlights ADD COLUMN note TEXT NOT NULL DEFAULT ''"],
  },
  {
    version: 9,
    name: 'reader_multiple_notes',
    statements: [
      "ALTER TABLE reader_highlights ADD COLUMN notes_json TEXT NOT NULL DEFAULT '[]'",
      'ALTER TABLE reader_highlights DROP COLUMN note',
    ],
  },
];
