import { describe, expect, it } from 'vitest';
import {
  parseReaderPerformanceLog,
  readerPerformanceSpans,
  formatReaderPerformanceReport,
} from '../../../../scripts/reader-perf-report.mjs';

const record = (data: Record<string, unknown>) => ({ v: 1, session: 'test', atMs: 1000, kind: 'event', ...data });

describe('reader performance log report', () => {
  it('accepts Metro and logcat prefixes while skipping truncated and unrelated output', () => {
    const span = record({
      name: 'reader.picture.compile',
      kind: 'span',
      durationMs: 12,
      workId: 'g:1',
      shapeMs: 8,
      hits: 80,
      misses: 20,
    });
    const input = ` LOG unrelated\n09-20 I ReactNativeJS: [LunarReader][perf] ${JSON.stringify(span)}\n[LunarReader][perf] {truncated\n`;
    const records = parseReaderPerformanceLog(input);
    expect(records).toEqual([span]);
    const report = formatReaderPerformanceReport(records);
    expect(report).toContain('reader.picture.compile');
    expect(report).toContain('reader.text.shape');
    expect(report).toContain('Work g:1');
    expect(report).toContain('hits=80 misses=20');
  });

  it('uses native timestamps instead of event delivery time and ignores duplicate terminal events', () => {
    const records = [
      record({ name: 'reader.native.submit', nativeId: 'lunar-interactive:1:2', accepted: true, workId: 'g:1' }),
      record({
        name: 'reader.native.event',
        nativeId: 'lunar-interactive:1:2#turn:3',
        event: 'gesture-started',
        nativeAtMs: 1030,
        atMs: 1100,
      }),
      record({
        name: 'reader.native.event',
        nativeId: 'lunar-interactive:1:2#turn:3',
        event: 'gesture-released',
        nativeAtMs: 1200,
        atMs: 1350,
        workId: 'g:1',
      }),
      record({
        name: 'reader.native.event',
        nativeId: 'lunar-interactive:1:2#turn:3',
        event: 'completed',
        nativeAtMs: 1400,
        atMs: 1500,
      }),
      record({
        name: 'reader.native.event',
        nativeId: 'lunar-interactive:1:2#turn:3',
        event: 'completed',
        nativeAtMs: 1400,
        atMs: 1510,
      }),
    ];
    expect(readerPerformanceSpans(records)).toMatchObject([
      { name: 'reader.native.stock-to-gesture', durationMs: 30, workId: 'g:1' },
      { name: 'reader.native.release-to-complete', durationMs: 200, workId: 'g:1' },
    ]);
  });

  it('keeps concurrent submissions and different JS sessions separate', () => {
    const records = [
      record({ name: 'reader.native.submit', nativeId: 'a:1', accepted: true, workId: 'one' }),
      record({ name: 'reader.native.submit', nativeId: 'a:2', accepted: true, workId: 'two', atMs: 1010 }),
      record({ name: 'reader.native.event', nativeId: 'a:2', event: 'started', nativeAtMs: 1030, atMs: 1040 }),
      record({ name: 'reader.native.event', nativeId: 'a:1', event: 'started', nativeAtMs: 1050, atMs: 1070 }),
      record({
        session: 'different',
        name: 'reader.native.event',
        nativeId: 'a:1',
        event: 'started',
        nativeAtMs: 1080,
        atMs: 1090,
      }),
    ];
    expect(readerPerformanceSpans(records)).toMatchObject([
      { durationMs: 20, workId: 'two' },
      { durationMs: 50, workId: 'one' },
    ]);
  });

  it('still accepts timestamp traces from older recordings', () => {
    const records = parseReaderPerformanceLog(
      JSON.stringify({
        traceEvents: [
          { ts: 1000, tid: 1, args: { data: { message: '[LunarReader] reader.open.start' } } },
          { ts: 31000, tid: 1, args: { data: { message: '[LunarReader] reader.open.end durationMs=30' } } },
        ],
      }),
    );
    expect(records).toMatchObject([{ name: 'reader.open', durationMs: 30 }]);
  });

  it('measures from command submission even if printing its log took longer than presentation', () => {
    const spans = readerPerformanceSpans([
      record({
        name: 'reader.native.submit',
        nativeId: 'a:1',
        accepted: true,
        submittedAtMs: 1000,
        atMs: 1040,
        workId: 'one',
      }),
      record({ name: 'reader.native.event', nativeId: 'a:1', event: 'started', nativeAtMs: 1020, atMs: 1050 }),
    ]);
    expect(spans).toMatchObject([{ name: 'reader.native.submit-to-present', durationMs: 20, workId: 'one' }]);
  });
});
