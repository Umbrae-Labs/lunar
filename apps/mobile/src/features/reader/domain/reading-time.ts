export interface ReadingSession {
  readonly id: string;
  readonly bookId: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly timeZone: string;
}

export interface DailyReadingTime {
  readonly date: string;
  readonly milliseconds: number;
}

/** Calendar dates belong to the zone in which the session was recorded. */
export function summarizeReadingTime(sessions: readonly ReadingSession[]): DailyReadingTime[] {
  const totals = new Map<string, number>();
  const formatters = new Map<string, Intl.DateTimeFormat>();
  for (const session of sessions) {
    if (session.endedAt <= session.startedAt) continue;
    let formatter = formatters.get(session.timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: session.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      formatters.set(session.timeZone, formatter);
    }
    let cursor = session.startedAt;
    while (cursor < session.endedAt) {
      const date = localDateKey(formatter, cursor);
      // The next local midnight is within 48 hours even on daylight-saving days.
      let low = cursor + 1;
      let high = Math.min(session.endedAt, cursor + 48 * 60 * 60 * 1000);
      if (localDateKey(formatter, high - 1) === date) {
        totals.set(date, (totals.get(date) ?? 0) + high - cursor);
        cursor = high;
        continue;
      }
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (localDateKey(formatter, middle) === date) low = middle + 1;
        else high = middle;
      }
      totals.set(date, (totals.get(date) ?? 0) + low - cursor);
      cursor = low;
    }
  }
  return [...totals]
    .map(([date, milliseconds]) => ({ date, milliseconds }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function readingDateKey(timestamp: number, timeZone: string): string {
  return localDateKey(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }),
    timestamp,
  );
}

function localDateKey(formatter: Intl.DateTimeFormat, timestamp: number): string {
  const parts = formatter.formatToParts(timestamp);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}
