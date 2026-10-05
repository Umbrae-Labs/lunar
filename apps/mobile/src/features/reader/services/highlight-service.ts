import { randomUUID } from 'expo-crypto';

import { getLunarDatabase } from '@/db';
import type { ReaderSourceRange } from '@/reader';
import type {
  ReaderHighlight,
  ReaderHighlightColor,
  ReaderHighlightStyle,
  ReaderNote,
} from '../domain/reader-highlight';
import { mergeReaderHighlight, normalizeReaderHighlights } from '../domain/highlight-ranges';
import { SQLiteHighlightRepository } from '../repositories/sqlite-highlight-repository';

export interface CreateReaderHighlightInput {
  readonly bookId: string;
  readonly href: string;
  readonly sourceRange: ReaderSourceRange;
  readonly text: string;
  readonly color?: ReaderHighlightColor;
  readonly style?: ReaderHighlightStyle;
  readonly notes?: readonly ReaderNote[];
}

export async function listReaderHighlights(bookId: string): Promise<readonly ReaderHighlight[]> {
  const database = await getLunarDatabase();
  const repository = new SQLiteHighlightRepository(database);
  const original = await repository.listByBookId(bookId);
  const normalized = normalizeReaderHighlights(original);
  if (normalized.length < original.length) {
    await database.withExclusiveTransactionAsync(async (transaction) => {
      const transactionalRepository = new SQLiteHighlightRepository(transaction);
      await transactionalRepository.remove(
        bookId,
        original.map((highlight) => highlight.id),
      );
      for (const highlight of normalized) await transactionalRepository.save(highlight);
    });
  }
  return normalized;
}

export async function createReaderHighlight(input: CreateReaderHighlightInput): Promise<ReaderHighlight> {
  const highlights = await listReaderHighlights(input.bookId);
  const { highlight, removedIds } = prepareReaderHighlight(input, highlights);
  await saveReaderHighlight(highlight, removedIds);
  return highlight;
}

export function prepareReaderHighlight(input: CreateReaderHighlightInput, highlights: readonly ReaderHighlight[]) {
  const highlight: ReaderHighlight = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
  };
  return mergeReaderHighlight(highlights, highlight);
}

export async function saveReaderHighlight(highlight: ReaderHighlight, removedIds: readonly string[]) {
  const database = await getLunarDatabase();
  await new SQLiteHighlightRepository(database).replace(highlight, removedIds);
}

export async function removeReaderHighlights(bookId: string, ids: readonly string[]) {
  const database = await getLunarDatabase();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    await new SQLiteHighlightRepository(transaction).remove(bookId, ids);
  });
}

export function createReaderNote(content: string): ReaderNote {
  const now = Date.now();
  return { id: randomUUID(), content, createdAt: now, updatedAt: now };
}

export async function updateReaderHighlightNotes(bookId: string, id: string, notes: readonly ReaderNote[]) {
  const database = await getLunarDatabase();
  await new SQLiteHighlightRepository(database).updateNotes(bookId, id, notes);
}
