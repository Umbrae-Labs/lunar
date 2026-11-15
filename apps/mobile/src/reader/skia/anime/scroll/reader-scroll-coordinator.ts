import { runOnUI } from 'react-native-worklets';
import type { SharedValue } from 'react-native-reanimated';

import type { ReaderSnapshot } from '../../../contracts';
import type { LunarReaderRuntime } from '../../../runtime/core/native-reader-runtime';
import { describeSnapshotIdentity, readerPageContentForSnapshot } from '../core/page-content';
import type { ReaderPageContent } from '../core/page-turn-types';
import {
  placeScrollWindows,
  scrollBounds,
  scrollJumpOffset,
  scrollWindowAt,
  type ReaderScrollNeighbor,
  type ReaderScrollPlacement,
} from './scroll-strip';

/** UI-thread state the scroll gesture and the composer read every frame. */
export interface ReaderScrollValues {
  /** Strip position at the view's top. */
  readonly offset: SharedValue<number>;
  readonly minOffset: SharedValue<number>;
  readonly maxOffset: SharedValue<number>;
  /** The visible window's place on the strip. */
  readonly visibleTop: SharedValue<number>;
  readonly visibleLength: SharedValue<number>;
  /** How far below the view's top the reading line runs: the content box's top. */
  readonly readingLine: SharedValue<number>;
  /** The step the UI thread asked for while the runtime follows: 1, -1, or 0 when none is pending. */
  readonly pendingStep: SharedValue<number>;
}

export interface ReaderScrollConfig {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

/** A window the strip shows: its content and where it sits. */
export interface ReaderScrollWindowContent extends ReaderScrollPlacement {
  readonly content: ReaderPageContent;
  /** View units per display-list unit. */
  readonly scale: number;
}

export interface ReaderScrollState {
  readonly windows: readonly ReaderScrollWindowContent[];
  /** The visible window's key: the one under the reading line. */
  readonly visibleKey?: string;
}

/** A point a tap landed on, in the display-list space of the window under it. */
export interface ReaderScrollHit {
  readonly content: ReaderPageContent;
  readonly x: number;
  readonly y: number;
}

const PEEK_DEPTH = 2;
const PEEK_RETRY_MS = 160;
const STEP_RETRY_MS = 400;

/**
 * Drives a scrolled reader. Rito's windows are spreads, so the runtime's own
 * navigation follows the strip: when the reading line crosses into the next
 * window the runtime turns to it, and its neighbors are peeked and placed
 * against it. A snapshot for a window the strip does not hold is a jump
 * (table of contents, a bookmark, a reflow): the strip restarts there, at the
 * line the navigation landed on.
 */
export class ReaderScrollCoordinator {
  private state: ReaderScrollState = { windows: [] };
  private readonly listeners = new Set<() => void>();
  private detach?: () => void;
  private disposed = false;
  private stepping = false;
  private travel: 'next' | 'previous' = 'next';
  private peekTimer?: ReturnType<typeof setTimeout>;
  private stepTimer?: ReturnType<typeof setTimeout>;
  private peekedKey?: string;

  constructor(
    readonly runtime: LunarReaderRuntime,
    private readonly values: ReaderScrollValues,
    private config: ReaderScrollConfig,
  ) {}

  getState = (): ReaderScrollState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  attach(): () => void {
    this.disposed = false;
    this.detach = this.runtime.subscribe(this.handleSnapshot);
    this.handleSnapshot(this.runtime.getSnapshot());
    return () => this.dispose();
  }

  configure(config: ReaderScrollConfig): void {
    const changed =
      config.viewportWidth !== this.config.viewportWidth || config.viewportHeight !== this.config.viewportHeight;
    this.config = config;
    // Windows were scaled to the old viewport: the strip restarts at the visible one.
    if (changed && this.detach) {
      this.state = { windows: [] };
      this.peekedKey = undefined;
      this.handleSnapshot(this.runtime.getSnapshot());
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach?.();
    this.detach = undefined;
    if (this.peekTimer !== undefined) clearTimeout(this.peekTimer);
    if (this.stepTimer !== undefined) clearTimeout(this.stepTimer);
    this.peekTimer = undefined;
    this.stepTimer = undefined;
    this.state = { windows: [] };
    this.notify();
  }

  /** The window under view point (`x`, `y`) and the point in its display-list space. */
  hitAt(x: number, y: number): ReaderScrollHit | undefined {
    const position = this.values.offset.get() + y;
    const index = scrollWindowAt(this.state.windows, position);
    const window = index === undefined ? undefined : this.state.windows[index];
    if (!window) return undefined;
    return { content: window.content, x: x / window.scale, y: (position - window.top) / window.scale };
  }

  /**
   * The UI thread found the reading line outside the visible window. The
   * runtime turns one window at a time; once it lands, the UI thread looks
   * again and asks for the next step if the line is still beyond it.
   */
  readonly step = (direction: 1 | -1): void => {
    if (this.disposed || this.stepping) return;
    const name = direction > 0 ? 'next' : 'previous';
    if (!this.runtime.canNavigate(name)) {
      this.retryStepLater();
      return;
    }
    this.stepping = true;
    this.travel = name;
    void (direction > 0 ? this.runtime.next() : this.runtime.previous())
      .catch(() => undefined)
      .finally(() => {
        this.stepping = false;
        if (this.disposed) return;
        const snapshot = this.runtime.getSnapshot();
        // A step that moved nowhere is tried again later rather than at once.
        if (snapshot.phase !== 'ready' || describeSnapshotIdentity(snapshot) === this.state.visibleKey) {
          this.retryStepLater();
        }
      });
  };

  /** The strip came to rest: records the line at the reading line as the reading position. */
  readonly settle = (): void => {
    if (this.disposed) return;
    const visible = this.state.windows.find((window) => window.key === this.state.visibleKey);
    if (!visible) return;
    const line = this.values.offset.get() + this.values.readingLine.get();
    const y = (line - visible.top) / visible.scale;
    if (y < 0 || y >= visible.length / visible.scale) return;
    const margins = this.runtime.getLayoutMargins();
    void this.runtime
      .refineReadingPosition(visible.content.snapshot.spreadIndex, { x: margins.left + 1, y })
      .catch(() => undefined);
  };

  private readonly handleSnapshot = (snapshot: ReaderSnapshot): void => {
    if (this.disposed || snapshot.phase !== 'ready' || this.config.viewportWidth <= 0) return;
    const content = readerPageContentForSnapshot(this.runtime, snapshot);
    const scrollWindow = content?.frame.scrollWindow;
    if (!content || !scrollWindow) return;
    const scale = this.scaleOf(content);
    const length = scrollWindow.length * scale;
    const previous = this.state;
    // A window is recognized by what it paints as well as by its key: turning
    // back past the first private slot relabels every slot, and adopting the
    // whole-book layout republishes the visible window under a new identity.
    const placed =
      previous.windows.find((window) => window.key === content.key) ??
      previous.windows.find(
        (window) =>
          content.frame.renderKey !== undefined &&
          window.content.snapshot.revisionId === snapshot.revisionId &&
          window.content.frame.renderKey === content.frame.renderKey,
      );
    const margins = this.runtime.getLayoutMargins();
    if (placed && (this.stepping || placed.key === previous.visibleKey)) {
      // The strip's own step, or the visible window republished: it stays put.
      const windows = previous.windows.map((window) =>
        window === placed ? { key: content.key, top: placed.top, length, content, scale } : window,
      );
      this.publish({ windows, visibleKey: content.key });
    } else if (placed) {
      // A jump to a window the strip already holds: scroll to its line.
      const windows = previous.windows.map((window) =>
        window === placed ? { key: content.key, top: placed.top, length, content, scale } : window,
      );
      const offset = scrollJumpOffset(placed.top, scale, margins.top, scrollWindow.targetOffset);
      this.publish({ windows, visibleKey: content.key }, offset);
    } else {
      // A jump elsewhere: the strip restarts at this window, showing the line
      // the navigation landed on at the top of the content box.
      const offset = scrollJumpOffset(0, scale, margins.top, scrollWindow.targetOffset);
      this.publish(
        { windows: [{ key: content.key, top: 0, length, content, scale }], visibleKey: content.key },
        offset,
      );
    }
    if (this.peekedKey !== content.key) this.peekedKey = undefined;
    this.values.pendingStep.set(0);
    this.schedulePeek();
  };

  private schedulePeek(delay = 0): void {
    if (this.peekTimer !== undefined) clearTimeout(this.peekTimer);
    this.peekTimer = setTimeout(() => {
      this.peekTimer = undefined;
      this.peekAround();
    }, delay);
  }

  /** Places the windows on either side of the visible one against it. */
  private peekAround(): void {
    const snapshot = this.runtime.getSnapshot();
    const key = this.state.visibleKey;
    if (this.disposed || snapshot.phase !== 'ready' || describeSnapshotIdentity(snapshot) !== key) return;
    if (this.peekedKey === key) return;
    void this.runtime
      .peekAdjacentPages(snapshot.revisionId, snapshot.spreadIndex, this.travel, PEEK_DEPTH)
      .then((pages) => {
        const visible = this.state.windows.find((window) => window.key === this.state.visibleKey);
        if (this.disposed || this.state.visibleKey !== key || !visible) return;
        const contents = new Map<string, ReaderScrollWindowContent>();
        const neighbors: ReaderScrollNeighbor[] = [];
        for (const page of pages) {
          if (!page.frame.scrollWindow) continue;
          const content: ReaderPageContent = {
            key: describeSnapshotIdentity(page.snapshot),
            snapshot: page.snapshot,
            picture: page.picture,
            frame: page.frame,
          };
          const scale = this.scaleOf(content);
          const length = page.frame.scrollWindow.length * scale;
          neighbors.push({ key: content.key, direction: page.direction, distance: page.distance, length });
          contents.set(content.key, { key: content.key, top: 0, length, content, scale });
        }
        const placements = placeScrollWindows({ key: visible.key, length: visible.length }, visible.top, neighbors);
        const windows = placements.map((placement) =>
          placement.key === visible.key ? visible : { ...contents.get(placement.key)!, top: placement.top },
        );
        this.publish({ windows, visibleKey: key });
        // A peek cut short by queued navigation is tried again once the reader settles.
        const complete = (['next', 'previous'] as const).every(
          (direction) => !this.runtime.canNavigate(direction) || pages.some((page) => page.direction === direction),
        );
        if (complete) this.peekedKey = key;
        else this.schedulePeek(PEEK_RETRY_MS);
      })
      .catch(() => this.schedulePeek(PEEK_RETRY_MS));
  }

  private retryStepLater(): void {
    if (this.stepTimer !== undefined) return;
    this.stepTimer = setTimeout(() => {
      this.stepTimer = undefined;
      if (!this.disposed) this.values.pendingStep.set(0);
    }, STEP_RETRY_MS);
  }

  private scaleOf(content: ReaderPageContent): number {
    return content.frame.width > 0 ? this.config.viewportWidth / content.frame.width : 1;
  }

  private publish(state: ReaderScrollState, jumpOffset?: number): void {
    this.state = state;
    const visible = state.windows.find((window) => window.key === state.visibleKey);
    const margins = this.runtime.getLayoutMargins();
    const offset = jumpOffset ?? this.values.offset.get();
    const bounds = scrollBounds(state.windows, this.config.viewportHeight, offset);
    const readingLine = margins.top * (visible?.scale ?? 1);
    const visibleTop = visible?.top ?? 0;
    const visibleLength = visible?.length ?? 0;
    runOnUI(
      (
        min: number,
        max: number,
        top: number,
        length: number,
        line: number,
        jump: number | undefined,
        values: ReaderScrollValues,
      ) => {
        'worklet';
        values.minOffset.value = min;
        values.maxOffset.value = max;
        values.visibleTop.value = top;
        values.visibleLength.value = length;
        values.readingLine.value = line;
        // Assigning stops a fling still running over the strip it left.
        if (jump !== undefined) values.offset.value = jump;
      },
    )(bounds.min, bounds.max, visibleTop, visibleLength, readingLine, jumpOffset, this.values);
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
