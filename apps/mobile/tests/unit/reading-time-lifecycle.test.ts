import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReadingTime } from '../../src/features/reader/hooks/session/use-reading-time';
const harness = vi.hoisted(() => ({
  cursor: 0,
  cells: [] as unknown[],
  pending: [] as (() => void)[],
  cleanups: [] as (() => void)[],
  listener: undefined as undefined | ((state: string) => void),
  app: { currentState: 'active' },
  start: vi.fn(),
  update: vi.fn(),
  sequence: 0,
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => `session-${++harness.sequence}` }));
vi.mock('react-native', () => ({
  AppState: Object.assign(harness.app, {
    addEventListener: (_: string, handler: (value: string) => void) => {
      harness.listener = handler;
      return { remove: vi.fn() };
    },
  }),
}));
vi.mock('../../src/features/reader/services/reading-time-service', () => ({
  startReadingSession: harness.start,
  updateReadingSessionEnd: harness.update,
}));
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.cells)) harness.cells[index] = typeof initial === 'function' ? initial() : initial;
    return [
      harness.cells[index],
      (value: unknown) => {
        harness.cells[index] = typeof value === 'function' ? value(harness.cells[index]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++;
    return (harness.cells[index] ??= { current: initial });
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = harness.cursor++;
    const previous = harness.cells[index] as unknown[] | undefined;
    if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) {
      harness.pending.push(() => {
        harness.cleanups[index]?.();
        harness.cleanups[index] = effect() ?? (() => {});
      });
      harness.cells[index] = deps;
    }
  },
}));
function render(focused = true, ready = true) {
  harness.cursor = 0;
  const result = useReadingTime('book', focused, ready);
  harness.pending.splice(0).forEach((effect) => effect());
  return result;
}
async function flush() {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}
function appState(value: string) {
  harness.app.currentState = value;
  harness.listener!(value);
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
  harness.cursor = 0;
  harness.cells = [];
  harness.cleanups = [];
  harness.pending = [];
  harness.app.currentState = 'active';
  harness.sequence = 0;
  vi.clearAllMocks();
  harness.start.mockResolvedValue(undefined);
  harness.update.mockResolvedValue(undefined);
});
afterEach(() => {
  harness.cleanups.forEach((cleanup) => cleanup?.());
  vi.useRealTimers();
});
describe('mobile reading time lifecycle', () => {
  it('records only ready, focused reading and flushes time when navigating away', async () => {
    render(true, false);
    await flush();
    expect(harness.start).not.toHaveBeenCalled();
    render(false, true);
    await flush();
    expect(harness.start).not.toHaveBeenCalled();
    render();
    await flush();
    expect(harness.start).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(12_000);
    await flush();
    expect(harness.update).toHaveBeenLastCalledWith('session-1', Date.parse('2026-10-16T12:00:10Z'));
    render(false);
    await flush();
    expect(harness.update).toHaveBeenLastCalledWith('session-1', Date.parse('2026-10-16T12:00:12Z'));
  });
  it('excludes background time and starts a distinct session after resume', async () => {
    render();
    await flush();
    await vi.advanceTimersByTimeAsync(5_000);
    appState('background');
    await flush();
    render();
    expect(harness.update).toHaveBeenLastCalledWith('session-1', Date.parse('2026-10-16T12:00:05Z'));
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(harness.update).toHaveBeenCalledTimes(1);
    appState('active');
    render();
    await flush();
    expect(harness.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'session-2', startedAt: Date.parse('2026-10-16T12:01:05Z') }),
    );
  });
  it('flushes once on unmount even when backgrounding and cleanup happen together', async () => {
    render();
    await flush();
    await vi.advanceTimersByTimeAsync(3_000);
    appState('inactive');
    harness.cleanups.forEach((cleanup) => cleanup?.());
    await flush();
    expect(harness.update).toHaveBeenCalledTimes(1);
    expect(harness.update).toHaveBeenCalledWith('session-1', Date.parse('2026-10-16T12:00:03Z'));
  });
});
