import { summarizeReadingTime, type ReadingSession } from '@/features/reader';

export interface StatisticsBook {
  id: string;
  title: string;
  author: string | null;
  coverUri: string | null;
  progress: number;
  milliseconds: number;
}

export function buildStatistics(books: readonly StatisticsBook[], sessions: readonly ReadingSession[]) {
  const byBook = new Map<string, ReadingSession[]>();
  for (const session of sessions) {
    const recorded = byBook.get(session.bookId) ?? [];
    recorded.push(session);
    byBook.set(session.bookId, recorded);
  }
  const dayBooks: Record<string, StatisticsBook[]> = {};
  for (const book of books) {
    for (const day of summarizeReadingTime(byBook.get(book.id) ?? [])) {
      (dayBooks[day.date] ??= []).push({ ...book, milliseconds: day.milliseconds });
    }
  }
  for (const rows of Object.values(dayBooks))
    rows.sort((a, b) => b.milliseconds - a.milliseconds || a.id.localeCompare(b.id));
  const daily = Object.entries(dayBooks)
    .map(([date, rows]) => ({ date, milliseconds: rows.reduce((sum, book) => sum + book.milliseconds, 0) }))
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = daily.reduce((sum, day) => sum + day.milliseconds, 0);
  return {
    books,
    daily,
    dayBooks,
    total,
    completed: books.filter((book) => book.progress >= 1).length,
    average: daily.length ? total / daily.length : 0,
  };
}

/** UTC is used only for calendar arithmetic; keys already represent recorded local dates. */
export function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export interface DateRange {
  start: string;
  end: string;
}

/** All period modules derive from this single, inclusive calendar-date slice. */
export function selectPeriod(data: ReturnType<typeof buildStatistics>, range: DateRange) {
  if (range.start > range.end) throw new Error('Invalid statistics range');
  const days = Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86_400_000) + 1;
  const totals = new Map(data.daily.map((day) => [day.date, day.milliseconds]));
  const daily = Array.from({ length: days }, (_, index) => {
    const date = shiftDate(range.start, index);
    return { date, milliseconds: totals.get(date) ?? 0 };
  });
  const byBook = new Map<string, StatisticsBook>();
  for (const day of daily)
    for (const book of data.dayBooks[day.date] ?? []) {
      const previous = byBook.get(book.id);
      byBook.set(book.id, { ...book, milliseconds: (previous?.milliseconds ?? 0) + book.milliseconds });
    }
  const books = [...byBook.values()]
    .filter((book) => book.milliseconds > 0)
    .sort((a, b) => b.milliseconds - a.milliseconds || a.id.localeCompare(b.id));
  const total = daily.reduce((sum, day) => sum + day.milliseconds, 0);
  return {
    range,
    daily,
    books,
    total,
    average: total / days,
    readingDays: daily.filter((day) => day.milliseconds > 0).length,
    ranking: books.slice(0, 10).map((book) => ({ ...book, share: total ? book.milliseconds / total : 0 })),
    remaining: books.slice(10).reduce((sum, book) => sum + book.milliseconds, 0),
  };
}

export function heatLevel(milliseconds: number) {
  return milliseconds <= 0
    ? 0
    : milliseconds < 1_800_000
      ? 1
      : milliseconds < 3_600_000
        ? 2
        : milliseconds < 7_200_000
          ? 3
          : 4;
}

export function buildHeatmap(today: string, daily: readonly { date: string; milliseconds: number }[]) {
  const end = new Date(`${today}T00:00:00Z`);
  const first = shiftDate(today, -364);
  const start = new Date(`${first}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const count = Math.floor((end.getTime() - start.getTime()) / (7 * 86_400_000)) + 1;
  const totals = new Map(daily.map((day) => [day.date, day.milliseconds]));
  return Array.from({ length: count }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + week * 7 + weekday);
      const key = date.toISOString().slice(0, 10);
      const milliseconds = totals.get(key) ?? 0;
      return {
        date: key,
        milliseconds,
        future: key > today || key < first,
        level: heatLevel(milliseconds),
      };
    }),
  );
}

export function durationParts(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return { hours: Math.floor(seconds / 3600), minutes: Math.floor(seconds / 60) % 60, seconds: seconds % 60 };
}
