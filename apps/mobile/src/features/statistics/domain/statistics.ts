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
    ranking: books.map((book) => ({ ...book, share: total ? book.milliseconds / total : 0 })),
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

export type StatisticsDimension = 'week' | 'month' | 'year';

/** The full calendar period `offset` steps before the one containing `today`; weeks start on Sunday. */
export function periodBounds(dimension: StatisticsDimension, today: string, offset = 0): DateRange {
  if (dimension === 'week') {
    const start = shiftDate(today, offset * 7 - new Date(`${today}T00:00:00Z`).getUTCDay());
    return { start, end: shiftDate(start, 6) };
  }
  const year = Number(today.slice(0, 4));
  if (dimension === 'year') return { start: `${year + offset}-01-01`, end: `${year + offset}-12-31` };
  const first = new Date(Date.UTC(year, Number(today.slice(5, 7)) - 1 + offset, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

/** Sunday-aligned week columns covering `range`; days outside it keep their slot but are not shown. */
export function buildHeatmap(
  range: DateRange,
  today: string,
  daily: readonly { date: string; milliseconds: number }[],
) {
  const start = shiftDate(range.start, -new Date(`${range.start}T00:00:00Z`).getUTCDay());
  const count = Math.floor((Date.parse(range.end) - Date.parse(start)) / (7 * 86_400_000)) + 1;
  const totals = new Map(daily.map((day) => [day.date, day.milliseconds]));
  return Array.from({ length: count }, (_, week) =>
    Array.from({ length: 7 }, (_, weekday) => {
      const date = shiftDate(start, week * 7 + weekday);
      const milliseconds = totals.get(date) ?? 0;
      return {
        date,
        milliseconds,
        outside: date < range.start || date > range.end,
        future: date > today,
        level: heatLevel(milliseconds),
      };
    }),
  );
}

/** One Sunday-first calendar per month touched by `range`; days after `today` are marked as future. */
export function monthCalendars(
  range: DateRange,
  today: string,
  daily: readonly { date: string; milliseconds: number }[],
) {
  const last = range.end.slice(0, 7);
  const calendars = [];
  for (let month = range.start.slice(0, 7); month <= last; month = shiftMonth(month, 1)) {
    const bounds = periodBounds('month', `${month}-01`);
    const weeks = buildHeatmap(
      {
        start: bounds.start < range.start ? range.start : bounds.start,
        end: bounds.end > range.end ? range.end : bounds.end,
      },
      today,
      daily,
    );
    const days = weeks.flat().filter((day) => !day.outside && !day.future);
    calendars.push({
      month: bounds.start,
      weeks,
      readingDays: days.filter((day) => day.milliseconds > 0).length,
      milliseconds: days.reduce((sum, day) => sum + day.milliseconds, 0),
    });
  }
  return calendars;
}

function shiftMonth(month: string, months: number) {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + months, 1));
  return date.toISOString().slice(0, 7);
}

export interface TrendBucket {
  unit: 'day' | 'month';
  /** The day, or the first day of the month, that the bar stands for. */
  date: string;
  milliseconds: number;
}

/** Daily bars stay legible up to about two months; longer periods are summed per calendar month. */
export function trendBuckets(daily: readonly { date: string; milliseconds: number }[]): TrendBucket[] {
  if (daily.length <= 62) return daily.map((day) => ({ unit: 'day', ...day }));
  const months = new Map<string, number>();
  for (const day of daily) {
    const month = `${day.date.slice(0, 7)}-01`;
    months.set(month, (months.get(month) ?? 0) + day.milliseconds);
  }
  return [...months].map(([date, milliseconds]) => ({ unit: 'month', date, milliseconds }));
}

export function durationParts(milliseconds: number) {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
