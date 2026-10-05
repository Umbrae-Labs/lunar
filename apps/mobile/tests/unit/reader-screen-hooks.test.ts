import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderHitEntry, ReaderRenderFrame, ReaderRuntime, ReaderSnapshot } from '@/reader';
import { useReaderPanels } from '../../src/features/reader/hooks/controls/use-reader-panels';
import { useReaderBookmarkActions } from '../../src/features/reader/hooks/bookmarks/use-reader-bookmark-actions';
import { useReaderContentActions } from '../../src/features/reader/hooks/content/use-reader-content-actions';
import { useReaderSelection } from '../../src/features/reader/hooks/selection/use-reader-selection';
import {
  createReaderImageFile,
  deleteReaderImageFile,
} from '../../src/features/reader/infrastructure/reader-image-file';

// Preserve state and refs across renders while scheduling effects after the hook returns.
// Native gesture callbacks and deferred operations are driven explicitly by each test.
const harness = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void }[],
  effects: [] as (() => void)[],
  gestures: [] as { kind: string; callbacks: Record<string, (...args: any[]) => void> }[],
  showToast: vi.fn(),
  commitSelection: undefined as ((...args: any[]) => void) | undefined,
  wordSelection: {
    text: 'Selected text',
    bounds: [{ x: 0, y: 0, width: 40, height: 20 }],
    geometryRequests: [{ pageIndex: 0 }],
  },
}));

vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    const slot = (harness.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial });
    return [
      slot.value,
      (value: unknown) => {
        slot.value = typeof value === 'function' ? value(slot.value) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++;
    return (harness.slots[index] ??= { value: { current: initial } }).value;
  },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
    const index = harness.cursor++;
    const previous = harness.slots[index];
    if (previous?.deps && deps.every((value, i) => Object.is(value, previous.deps![i]))) return;
    const slot = (harness.slots[index] = { deps });
    harness.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = effect() || undefined;
    });
  },
}));
vi.mock('@/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('heroui-native/toast', () => ({ useToast: () => ({ toast: { show: harness.showToast } }) }));
vi.mock('expo-linking', () => ({ canOpenURL: vi.fn(async () => true), openURL: vi.fn() }));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('react-native-worklets', () => ({
  scheduleOnRN: (callback: (...args: any[]) => void, ...args: any[]) => callback(...args),
}));
vi.mock('@/reader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/reader')>()),
  createReaderWordSelectionAtPoint: () => harness.wordSelection,
  createReaderTextSelectionFromRange: () => harness.wordSelection,
}));
vi.mock('../../src/features/reader/hooks/selection/use-reader-selection-drag', () => ({
  useReaderSelectionDrag: ({ onCommit }: { onCommit: (...args: any[]) => void }) => {
    harness.commitSelection = onCommit;
    return { begin: vi.fn(), move: vi.fn(), finish: vi.fn(), initialize: vi.fn() };
  },
}));
vi.mock('../../src/features/reader/infrastructure/reader-image-file', () => ({
  createReaderImageFile: vi.fn(() => 'file:///reader-image.png'),
  deleteReaderImageFile: vi.fn(),
}));
vi.mock('react-native-gesture-handler', () => {
  const create = (kind: string) => {
    const record = { kind, callbacks: {} as Record<string, (...args: any[]) => void> };
    const gesture: any = new Proxy(record, {
      get(target, property: string) {
        if (property in target) return target[property as keyof typeof target];
        return (...args: any[]) => {
          if (property.startsWith('on')) target.callbacks[property] = args[0];
          return gesture;
        };
      },
    });
    harness.gestures.push(record);
    return gesture;
  };
  return { Gesture: { Tap: () => create('tap'), Pan: () => create('pan') } };
});

function render<T>(hook: () => T): T {
  harness.cursor = 0;
  const result = hook();
  harness.effects.splice(0).forEach((effect) => effect());
  return result;
}

function unmount() {
  harness.slots.forEach((slot) => slot.cleanup?.());
  harness.slots = [];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function snapshot(): ReaderSnapshot {
  return {
    phase: 'ready',
    bookId: 'book',
    revisionId: 1,
    spreadIndex: 2,
    renderId: 3,
    position: { locator: { spineIdref: 'chapter', manifestHref: 'chapter.xhtml', chapterProgress: 0 } },
  } as ReaderSnapshot;
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.slots = [];
  harness.effects = [];
  harness.gestures = [];
  harness.commitSelection = undefined;
});
afterEach(() => {
  unmount();
  vi.useRealTimers();
});

describe('reader panels', () => {
  it('keeps the new panel open when the previous drawer finishes closing', () => {
    let panels = render(() => useReaderPanels(true));
    panels.setPanelOpen('toc', true);
    panels = render(() => useReaderPanels(true));
    expect(panels.activePanel).toBe('toc');
    panels.setPanelOpen('marks', true);
    panels.setPanelOpen('toc', false);
    panels = render(() => useReaderPanels(true));
    expect(panels.activePanel).toBe('marks');
    panels.setPanelOpen('marks', false);
    expect(render(() => useReaderPanels(true)).activePanel).toBeUndefined();
  });
});

describe('reader bookmark actions', () => {
  function setup() {
    let latest = snapshot();
    const options = {
      snapshot: latest,
      currentHitEntries: [],
      chapterTitle: 'Chapter',
      bookmarks: [],
      runtime: { getSnapshot: () => latest, getCurrentHitMap: () => ({ entries: [] }) } as unknown as ReaderRuntime,
      addBookmark: vi.fn(),
      removeBookmark: vi.fn(),
      onPullStart: vi.fn(),
    };
    return {
      options,
      setSnapshot: (value: ReaderSnapshot) => {
        latest = value;
      },
    };
  }

  it.each(['bookId', 'revisionId', 'spreadIndex', 'renderId'] as const)(
    'ignores a pull after the page changes its %s',
    async (field) => {
      const { options, setSnapshot } = setup();
      const actions = render(() => useReaderBookmarkActions(options));
      actions.beginBookmarkPull();
      setSnapshot({ ...options.snapshot, [field]: field === 'bookId' ? 'another-book' : 99 });
      await actions.commitBookmarkPull();
      expect(options.addBookmark).not.toHaveBeenCalled();
      expect(options.removeBookmark).not.toHaveBeenCalled();
    },
  );

  it('deduplicates a pull submission and clears its temporary bookmark after save failure', async () => {
    const { options } = setup();
    const save = deferred<never>();
    options.addBookmark.mockReturnValue(save.promise);
    let actions = render(() => useReaderBookmarkActions(options));
    actions.beginBookmarkPull();
    const operation = actions.commitBookmarkPull();
    await actions.commitBookmarkPull();
    expect(options.addBookmark).toHaveBeenCalledTimes(1);
    actions = render(() => useReaderBookmarkActions(options));
    const frame = { pages: [] } as unknown as ReaderRenderFrame;
    expect(actions.resolvePageBookmark(options.snapshot, frame)).toBe(true);
    save.reject(new Error('Save failed'));
    await operation;
    actions = render(() => useReaderBookmarkActions(options));
    expect(actions.resolvePageBookmark(options.snapshot, frame)).toBe(false);
    expect(harness.showToast).toHaveBeenCalledWith({ variant: 'danger', label: 'reader.bookmarkSaveFailed' });
  });
});

describe('reader content actions', () => {
  function setup() {
    const hit = {
      imageSource: 'image.png',
      href: 'chapter.xhtml#image',
      pageIndex: 0,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
    } as ReaderHitEntry;
    const runtime = {
      getCurrentHitMap: () => ({ entries: [hit] }),
      getCurrentImageBytes: () => new Uint8Array([1]),
      goToToc: vi.fn(),
      readFootnote: vi.fn(),
    };
    const options = {
      runtime: runtime as unknown as ReaderRuntime,
      snapshot: snapshot(),
      imageInteractionEnabled: true,
    };
    return { runtime, hit, options };
  }

  it('cancels the pending image link on double tap and releases the preview file on close', async () => {
    vi.useFakeTimers();
    const { options, hit, runtime } = setup();
    let actions = render(() => useReaderContentActions(options));
    expect(actions.openContentHit(hit)).toBe(true);
    harness.gestures.at(-1)!.callbacks.onEnd({ x: 20, y: 20 }, true);
    await vi.advanceTimersByTimeAsync(300);
    expect(runtime.goToToc).not.toHaveBeenCalled();
    expect(createReaderImageFile).toHaveBeenCalledTimes(1);
    actions = render(() => useReaderContentActions(options));
    expect(actions.activeImageViewer?.uri).toBe('file:///reader-image.png');
    actions.closeImageViewer();
    expect(render(() => useReaderContentActions(options)).activeImageViewer).toBeUndefined();
    expect(deleteReaderImageFile).toHaveBeenCalledExactlyOnceWith('file:///reader-image.png');
  });

  it('opens a single-tapped image link after the double-tap interval and cancels pending work on unmount', async () => {
    vi.useFakeTimers();
    const { options, hit, runtime } = setup();
    const actions = render(() => useReaderContentActions(options));
    actions.openContentHit(hit);
    await vi.advanceTimersByTimeAsync(299);
    expect(runtime.goToToc).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runtime.goToToc).toHaveBeenCalledExactlyOnceWith(hit.href);
    actions.openContentHit(hit);
    unmount();
    await vi.advanceTimersByTimeAsync(300);
    expect(runtime.goToToc).toHaveBeenCalledTimes(1);
  });

  it('ignores a footnote result after the drawer is closed', async () => {
    const { options, runtime } = setup();
    const read = deferred<object>();
    runtime.readFootnote.mockReturnValue(read.promise);
    let actions = render(() => useReaderContentActions(options));
    const operation = actions.openFootnote('note');
    actions = render(() => useReaderContentActions(options));
    expect(actions.isFootnoteOpen).toBe(true);
    actions.handleFootnoteOpenChange(false);
    read.resolve({ key: 'note' });
    await operation;
    actions = render(() => useReaderContentActions(options));
    expect(actions.isFootnoteOpen).toBe(false);
    expect(actions.footnote).toBeUndefined();
  });
});

describe('reader selection ownership', () => {
  it.each(['revisionId', 'spreadIndex', 'renderId'] as const)(
    'ignores a delayed selection start after the runtime changes its %s before React renders', (field) => {
      const owner = snapshot();
      const runtime = {
        getSnapshot: () => ({ ...owner, [field]: 99 }),
        getCurrentHitMap: vi.fn(() => ({ entries: [] })),
      };
      const onSelectionStart = vi.fn();
      const options = { runtime, snapshot: owner, currentHitEntries: [], highlights: [],
        enabled: true, onSelectionStart } as unknown as Parameters<typeof useReaderSelection>[0];
      const selection = render(() => useReaderSelection(options));
      harness.gestures.at(-1)!.callbacks.onStart({ x: 0, y: 0 });
      expect(runtime.getCurrentHitMap).not.toHaveBeenCalled();
      expect(selection.getSelection()).toBeUndefined();
      expect(onSelectionStart).not.toHaveBeenCalled();
    },
  );

  it('ignores a delayed drag commit from a React callback that belongs to the previous page', () => {
    const owner = snapshot();
    const current = { ...owner, renderId: 4 };
    const runtime = {
      getSnapshot: () => current,
      getCurrentHitMap: vi.fn(() => ({ entries: [] })),
      resolveTextRangeGeometry: vi.fn(),
    };
    const options = { runtime, snapshot: owner, currentHitEntries: [], highlights: [],
      enabled: true, onSelectionStart: vi.fn() } as unknown as Parameters<typeof useReaderSelection>[0];
    const selection = render(() => useReaderSelection(options));
    harness.commitSelection!({}, { x: 0, y: 0 }, '1:2:4');
    expect(runtime.getCurrentHitMap).not.toHaveBeenCalled();
    expect(runtime.resolveTextRangeGeometry).not.toHaveBeenCalled();
    expect(selection.getSelection()).toBeUndefined();
  });

  it('releases pagination suspension and ignores late geometry after navigation', async () => {
    let latest = snapshot();
    const geometry = deferred<unknown[]>();
    const resumePagination = vi.fn();
    const runtime = {
      getSnapshot: () => latest,
      getCurrentHitMap: () => ({ entries: [] }),
      resolveTextRangeGeometry: () => geometry.promise,
      suspendBackgroundPagination: vi.fn(() => resumePagination),
    };
    const options = {
      runtime,
      snapshot: latest,
      currentHitEntries: [],
      highlights: [],
      enabled: true,
      onSelectionStart: vi.fn(),
    } as unknown as Parameters<typeof useReaderSelection>[0];
    let selection = render(() => useReaderSelection(options));
    harness.gestures.at(-1)!.callbacks.onStart({ x: 0, y: 0 });
    selection = render(() => useReaderSelection(options));
    expect(selection.selection?.text).toBe('Selected text');
    expect(runtime.suspendBackgroundPagination).toHaveBeenCalledTimes(1);
    harness.commitSelection!({}, { x: 0, y: 0 }, '1:2:3');
    latest = { ...latest, renderId: 4 };
    selection = render(() => useReaderSelection({ ...options, snapshot: latest }));
    expect(selection.selection).toBeUndefined();
    expect(resumePagination).toHaveBeenCalledTimes(1);
    geometry.resolve([{ bounds: { x: 200, y: 200, width: 50, height: 10 } }]);
    await geometry.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(selection.getSelection()?.bounds).toEqual(harness.wordSelection.bounds);
  });
});
