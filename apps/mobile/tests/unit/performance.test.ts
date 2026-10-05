import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isReaderPerformanceEnabled,
  isReaderTraceEnabled,
  isReaderVerboseTraceEnabled,
  readerDiagnostic,
  readerPerformanceEnd,
  readerPerformanceStart,
  readerPerformanceMark,
  readerPerformanceActivity,
  flushReaderPerformanceActivities,
  readerPerformanceAsync,
  startReaderPerformanceMonitor,
} from '../../src/reader/runtime/core/performance';

afterEach(() => {
  delete globalThis.LUNAR_READER_PERF;
  delete globalThis.LUNAR_READER_TRACE;
  delete globalThis.LUNAR_READER_TRACE_VERBOSE;
  delete globalThis.__LUNAR_READER_PERF__;
  flushReaderPerformanceActivities();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('reader performance diagnostics', () => {
  it('accepts the short console flag name', () => {
    globalThis.LUNAR_READER_PERF = true;
    expect(isReaderPerformanceEnabled()).toBe(true);
    expect(isReaderTraceEnabled()).toBe(false);
  });

  it('allows trace logging to be enabled independently', () => {
    globalThis.LUNAR_READER_TRACE = true;
    expect(isReaderPerformanceEnabled()).toBe(false);
    expect(isReaderTraceEnabled()).toBe(true);
  });

  it('keeps logging failures away from reader operations', () => {
    globalThis.LUNAR_READER_PERF = true;
    globalThis.LUNAR_READER_TRACE = true;
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('debugger logging failed');
    });

    expect(() => readerPerformanceMark('reader.test')).not.toThrow();
    expect(() => readerDiagnostic('reader.test')).not.toThrow();
  });

  it('keeps default state traces to failures instead of duplicating timing events', () => {
    globalThis.LUNAR_READER_TRACE = true;
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    readerDiagnostic('runtime.show.ready', 'spread=2');
    readerDiagnostic('bg.result', 'state=advanced');
    readerDiagnostic('frame.reject', 'spread=2');

    expect(info.mock.calls.map(([message]) => message)).toEqual([
      '[LunarReader][trace] frame.reject spread=2',
    ]);
  });

  it('exposes verbose trace only when explicitly enabled', () => {
    globalThis.LUNAR_READER_TRACE = true;
    globalThis.LUNAR_READER_TRACE_VERBOSE = true;
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    expect(isReaderVerboseTraceEnabled()).toBe(true);
    readerDiagnostic('bg.result', 'state=advanced');

    expect(info).toHaveBeenCalledWith('[LunarReader][trace] bg.result state=advanced');
  });

  it('reports compile durations instead of filtering out navigation work', () => {
    globalThis.LUNAR_READER_PERF = true;
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const startedAt = readerPerformanceStart('reader.picture.compile');
    readerPerformanceEnd('reader.picture.compile', startedAt);
    readerPerformanceMark('reader.firstReadySnapshot', 'spread=0');

    const records = info.mock.calls.map(([message]) => JSON.parse(String(message).split('[LunarReader][perf] ')[1]));
    expect(records[0]).toMatchObject({ v: 1, kind: 'span', name: 'reader.picture.compile', durationMs: expect.any(Number) });
    expect(records[1]).toMatchObject({ kind: 'event', name: 'reader.firstReadySnapshot', detail: 'spread=0' });
  });

  it('does not evaluate disabled diagnostic details or schedule any monitoring', () => {
    const detail = vi.fn(() => 'expensive state');
    const fields = vi.fn(() => ({ value: 1 }));
    vi.useFakeTimers();
    readerDiagnostic('turn.surface.state', detail);
    readerPerformanceMark('reader.test', fields);
    readerPerformanceActivity('surface.commit');
    const stop = startReaderPerformanceMonitor();
    expect(vi.getTimerCount()).toBe(0);
    expect(detail).not.toHaveBeenCalled();
    expect(fields).not.toHaveBeenCalled();
    stop();
  });

  it('aggregates busy activity into one log and stops scheduling after the window', () => {
    vi.useFakeTimers();
    globalThis.LUNAR_READER_PERF = true;
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    for (let i = 0; i < 120; i += 1) readerPerformanceActivity('native.poll', 2);
    expect(info).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(info).toHaveBeenCalledTimes(1);
    const record = JSON.parse(String(info.mock.calls[0][0]).split('[LunarReader][perf] ')[1]);
    expect(record.activities['native.poll']).toMatchObject({ count: 120, totalMs: 240, maxMs: 2 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('records rejected work while preserving the original error', async () => {
    globalThis.LUNAR_READER_PERF = true;
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = new Error('native rejected');
    await expect(readerPerformanceAsync('reader.backend.adjacent', async () => { throw error; }, { workId: 'turn-1' })).rejects.toBe(error);
    const record = JSON.parse(String(info.mock.calls[0][0]).split('[LunarReader][perf] ')[1]);
    expect(record).toMatchObject({ name: 'reader.backend.adjacent', workId: 'turn-1', status: 'error' });
    expect(() => readerPerformanceMark('reader.test', () => { throw new Error('detail failed'); })).not.toThrow();
  });
});
