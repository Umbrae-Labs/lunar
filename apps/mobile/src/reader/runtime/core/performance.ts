declare global {
  var LUNAR_READER_PERF: boolean | undefined;
  var LUNAR_READER_TRACE: boolean | undefined;
  var LUNAR_READER_TRACE_VERBOSE: boolean | undefined;
  var __LUNAR_READER_PERF__: boolean | undefined;
}

export type ReaderPerformanceFields = Readonly<Record<string, string | number | boolean | undefined>>;
type PerformanceDetail = ReaderPerformanceFields | string | (() => ReaderPerformanceFields);
const session = Date.now().toString(36);
let sequence = 0;
const activities = new Map<
  string,
  { count: number; totalMs: number; maxMs: number; latest?: ReaderPerformanceFields }
>();
let activityTimer: ReturnType<typeof setTimeout> | undefined;
let activityStartedAt = 0;

export function isReaderPerformanceEnabled(): boolean {
  return (
    process.env.EXPO_PUBLIC_READER_PERF === '1' ||
    globalThis.LUNAR_READER_PERF === true ||
    globalThis.__LUNAR_READER_PERF__ === true
  );
}

export function isReaderTraceEnabled(): boolean {
  return process.env.EXPO_PUBLIC_READER_TRACE === '1' || globalThis.LUNAR_READER_TRACE === true;
}

export function isReaderVerboseTraceEnabled(): boolean {
  return globalThis.LUNAR_READER_TRACE_VERBOSE === true;
}

export function readerPerformanceId(kind: string): string | undefined {
  return isReaderPerformanceEnabled() ? `${kind}:${session}:${++sequence}` : undefined;
}

export function readerPerformanceMark(name: string, detail?: PerformanceDetail): void {
  if (!isReaderPerformanceEnabled()) return;
  try {
    writeRecord({ kind: 'event', name, ...resolveDetail(detail) });
  } catch {
    /* A diagnostic detail supplier must not affect the operation. */
  }
}

export async function readerPerformanceAsync<T>(
  name: string,
  action: () => Promise<T>,
  detail?: PerformanceDetail,
): Promise<T> {
  const startedAt = readerPerformanceStart();
  let status = 'ok';
  try {
    return await action();
  } catch (error) {
    status = 'error';
    throw error;
  } finally {
    readerPerformanceEnd(name, startedAt, () => ({ ...resolveDetail(detail), status }));
  }
}

export function readerPerformanceStart(_name?: string): number | undefined {
  return isReaderPerformanceEnabled() ? performance.now() : undefined;
}

export function readerPerformanceEnd(name: string, startedAt: number | undefined, detail?: PerformanceDetail): void {
  if (startedAt === undefined || !isReaderPerformanceEnabled()) return;
  const durationMs = Math.max(0, performance.now() - startedAt);
  try {
    writeRecord({ kind: 'span', name, durationMs, startAtMs: Date.now() - durationMs, ...resolveDetail(detail) });
  } catch {
    /* A diagnostic detail supplier must not affect the operation. */
  }
}

/** One summary per active two-second window, never one console call per frame. */
export function readerPerformanceActivity(name: string, durationMs = 0, detail?: ReaderPerformanceFields): void {
  if (!isReaderPerformanceEnabled()) return;
  const activity = activities.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
  activity.count += 1;
  activity.totalMs += durationMs;
  activity.maxMs = Math.max(activity.maxMs, durationMs);
  activity.latest = detail;
  activities.set(name, activity);
  if (activityTimer === undefined) {
    activityStartedAt = performance.now();
    activityTimer = setTimeout(flushReaderPerformanceActivities, 2000);
  }
}

export function flushReaderPerformanceActivities(): void {
  if (activityTimer !== undefined) clearTimeout(activityTimer);
  activityTimer = undefined;
  if (isReaderPerformanceEnabled() && activities.size > 0) {
    writeRecord({
      kind: 'activity',
      name: 'reader.activity',
      windowMs: Math.max(0, performance.now() - activityStartedAt),
      activities: Object.fromEntries(activities),
    });
  }
  activities.clear();
}

/** Optional JS scheduling probe; this measures timer delay, not GPU frame loss. */
export function startReaderPerformanceMonitor(): () => void {
  if (!isReaderPerformanceEnabled()) return () => undefined;
  let expected = performance.now() + 250;
  const timer = setInterval(() => {
    const now = performance.now();
    readerPerformanceActivity('js.timer-lag', Math.max(0, now - expected));
    expected = now + 250;
  }, 250);
  return () => {
    clearInterval(timer);
    flushReaderPerformanceActivities();
  };
}

/** Detailed state traces are separate from timing; expensive details are lazy. */
export function readerDiagnostic(name: string, detail?: string | (() => string)): void {
  if (!isReaderTraceEnabled() || (!isReaderVerboseTraceEnabled() && !isConciseTraceEvent(name))) return;
  try {
    const value = typeof detail === 'function' ? detail() : detail;
    console.info(`[LunarReader][trace] ${name}${value ? ` ${value}` : ''}`);
  } catch {
    /* Diagnostics must never change navigation. */
  }
}

function resolveDetail(detail?: PerformanceDetail): ReaderPerformanceFields {
  return typeof detail === 'function' ? detail() : typeof detail === 'string' ? { detail } : (detail ?? {});
}

function writeRecord(record: Record<string, unknown>): void {
  try {
    // timeStamp can crash on Hermes/Android. Metro and logcat preserve this
    // JSON line, and the report tool consumes exactly the same format.
    console.info(`[LunarReader][perf] ${JSON.stringify({ v: 1, session, atMs: Date.now(), ...record })}`);
  } catch {
    /* Diagnostics must never change navigation. */
  }
}

function isConciseTraceEvent(name: string): boolean {
  return (
    name.endsWith('.error') ||
    name.endsWith('.reject') ||
    name.endsWith('.miss') ||
    name.endsWith('.empty') ||
    name.endsWith('.range') ||
    name === 'slot.drift'
  );
}
