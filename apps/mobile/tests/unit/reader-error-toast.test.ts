import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReaderErrorToast } from '../../src/features/reader/hooks/session/use-reader-error-toast';

const harness = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as { value?: unknown; deps?: readonly unknown[] }[],
  effects: [] as (() => void)[],
  replay: [] as (() => void)[],
  renderPending: false,
  show: vi.fn(),
}));

vi.mock('react', () => ({
  useRef: (initial: unknown) => {
    const slot = (harness.slots[harness.cursor++] ??= { value: { current: initial } });
    return slot.value;
  },
  useEffectEvent: (callback: () => void) => {
    const slot = (harness.slots[harness.cursor++] ??= {});
    slot.value = callback;
    return () => (slot.value as () => void)();
  },
  useEffect: (effect: () => void, deps: readonly unknown[]) => {
    const index = harness.cursor++;
    const previous = harness.slots[index];
    if (
      previous?.deps &&
      deps.length === previous.deps.length &&
      deps.every((value, i) => Object.is(value, previous.deps![i]))
    )
      return;
    harness.slots[index] = { deps };
    harness.effects.push(effect);
    harness.replay.push(effect);
  },
}));
// Like HeroUI, each toast update supplies a new API object and callbacks.
vi.mock('heroui-native/toast', () => ({
  useToast: () => ({ toast: { show: (options: unknown) => harness.show(options) } }),
}));

function ReaderErrorNotification(options: Parameters<typeof useReaderErrorToast>[0]) {
  useReaderErrorToast(options);
}

function ReaderIndependentErrors() {
  const options = { bookId: 'book', error: true };
  useReaderErrorToast({ ...options, label: 'Reading time save failed' });
  useReaderErrorToast({ ...options, label: 'Bookmarks unavailable' });
  useReaderErrorToast({ ...options, label: 'Highlights unavailable' });
}

function render(options: Parameters<typeof useReaderErrorToast>[0]) {
  let renders = 0;
  do {
    if (++renders > 20) throw new Error('Maximum update depth exceeded');
    harness.renderPending = false;
    harness.cursor = 0;
    ReaderErrorNotification(options);
    harness.effects.splice(0).forEach((effect) => effect());
  } while (harness.renderPending);
}

beforeEach(() => {
  harness.cursor = 0;
  harness.slots = [];
  harness.effects = [];
  harness.replay = [];
  harness.renderPending = false;
  harness.show.mockReset().mockImplementation(() => {
    harness.renderPending = true;
  });
});

describe('reader error notifications', () => {
  it.each([
    ['reader.readingTimeSaveFailed', true],
    ['reader.bookmarkLoadFailed', new Error('Bookmarks unavailable')],
    ['reader.highlightLoadFailed', new Error('Highlights unavailable')],
    ['reader.loadingFailed', 'Book unavailable'],
  ])('shows %s once despite toast provider updates', (label, error) => {
    const options = { bookId: 'book', error, label: String(label) };
    expect(() => render(options)).not.toThrow();
    render(options);
    expect(harness.show).toHaveBeenCalledExactlyOnceWith({ variant: 'danger', label });
  });

  it('keeps a dismissed error from being shown again after message changes or effect replay', () => {
    const options = { bookId: 'book', error: true, label: 'Save failed' };
    render(options);
    harness.replay.forEach((effect) => effect());
    render({ ...options, label: 'Translated save failure' });
    expect(harness.show).toHaveBeenCalledTimes(1);
  });

  it('uses the latest message when an error returns after recovery', () => {
    const options = { bookId: 'book', error: true, label: 'Save failed' };
    render(options);
    render({ ...options, error: false });
    render({ ...options, label: 'Translated save failure' });
    expect(harness.show).toHaveBeenCalledTimes(2);
    expect(harness.show).toHaveBeenLastCalledWith({ variant: 'danger', label: 'Translated save failure' });
  });

  it('notifies for a new error or another book and includes the loading description', () => {
    const options = { bookId: 'book', error: 'First error', label: 'Loading failed', description: 'First error' };
    render(options);
    render({ ...options, error: 'Second error', description: 'Second error' });
    render({ ...options, bookId: 'another-book', error: 'Second error', description: 'Second error' });
    expect(harness.show).toHaveBeenCalledTimes(3);
    expect(harness.show).toHaveBeenLastCalledWith({
      variant: 'danger',
      label: 'Loading failed',
      description: 'Second error',
    });
  });

  it('allows independent failures to each display once', () => {
    for (let i = 0; i < 3; i++) {
      harness.cursor = 0;
      ReaderIndependentErrors();
      harness.effects.splice(0).forEach((effect) => effect());
    }
    expect(harness.show).toHaveBeenCalledTimes(3);
  });
});
