import type {
  BookInfo,
  Decoration,
  DecorationLayer,
  NavigationTarget,
  ReaderAPI,
  ReaderEventName,
  ReaderEvents,
  ReaderInterceptors,
  ReaderLocation,
  ReaderSessionInfo,
  SearchHit,
  SelectionMenuItem,
  SelectionSnapshot,
  TextSegment,
  TocItem,
  ToolbarItem,
} from '@umbrae-labs/lunar-plugin-sdk';
import { hasPermission } from '@umbrae-labs/lunar-plugin-sdk/manifest';

import type {
  ReaderExtensionDecoration,
  ReaderExtensionSelection,
  ReaderExtensionSessionControls,
  ReaderSessionBook,
  ReaderSessionEvent,
  ReaderSessionLocation,
  ReaderSessionPort,
  ReaderSessionState,
} from '@/features/reader';
import type { ReaderTocEntry } from '@/reader';
import { LunarPluginError, pluginErrorMessage } from '../domain/plugin-error';
import {
  createTextSegmentKey,
  decodeLocatorRef,
  decodeRangeRef,
  encodeLocatorRef,
  encodeRangeRef,
} from '../domain/plugin-refs';
import type { PluginGeneration } from './plugin-generation';
import type { PluginEntry, PluginHost } from './plugin-host';

export const READER_BRIDGE_LIMITS = {
  layersPerPlugin: 4,
  decorationsPerLayer: 500,
  layerUpdateIntervalMs: 100,
  selectionCharacters: 32_768,
  selectionGrantMs: 5 * 60_000,
  selectionGrants: 32,
  interceptorBudgetMs: 16,
  interceptorOverrunsBeforeSkip: 3,
  pluginSelectionItems: 6,
  searchResults: 100,
} as const;

const ReaderEventNames = new Set<ReaderEventName>([
  'open',
  'ready',
  'locationChange',
  'chapterChange',
  'selectionChange',
  'layoutChange',
  'paginationChange',
  'close',
]);
const DecorationStyles = new Set(['background', 'outline', 'underline', 'wavy']);
const DecorationColors = new Set(['yellow', 'pink', 'purple', 'blue', 'green', 'accent']);
const LayerId = /^[a-z][a-z0-9-]{0,31}$/;

export function pluginPanelKey(pluginId: string, panelId: string): string {
  return `plugin:${pluginId}:${panelId}`;
}

interface QueuedEvent {
  readonly name: ReaderEventName;
  readonly payload: () => ReaderEvents[ReaderEventName];
}

interface LayerState {
  readonly pluginId: string;
  decorations: readonly ReaderExtensionDecoration[];
  lastAppliedAt: number;
  pending?: readonly ReaderExtensionDecoration[];
  timer?: ReturnType<typeof setTimeout>;
}

interface SelectionGrant {
  readonly pluginId: string;
  readonly snapshot: SelectionSnapshot;
  readonly expiresAt: number;
}

/** Connects plugins to the reading session the reader screen attached. */
export class PluginReaderBridge {
  private port?: ReaderSessionPort;
  private controls?: ReaderExtensionSessionControls;
  private openBookId?: string;
  private hasSelection = false;
  private queue: QueuedEvent[] = [];
  private flushScheduled = false;
  private sessionCache?: { readonly state: ReaderSessionState; readonly info: ReaderSessionInfo | undefined };
  private readonly sessionListeners = new Set<() => void>();
  private readonly layers = new Map<string, LayerState>();
  private decorationsCache?: readonly ReaderExtensionDecoration[];
  private readonly grants = new Map<string, SelectionGrant>();
  private grantCounter = 0;
  private detachCurrent?: () => void;

  constructor(private readonly host: PluginHost) {}

  attach(port: ReaderSessionPort, controls: ReaderExtensionSessionControls): () => void {
    this.detach();
    this.port = port;
    this.controls = controls;
    this.hasSelection = port.getState().hasSelection;
    const unsubscribeEvents = port.events.onAny((event) => this.onSessionEvent(event));
    const unsubscribeState = port.subscribe(() => this.onSessionState());
    const state = port.getState();
    // A screen can attach after its session opened, e.g. after a fast refresh.
    if (state.lifecycle !== 'closed' && state.book) this.onSessionEvent({ type: 'open', bookId: state.book.id });
    this.host.notify();
    const detach = () => {
      unsubscribeEvents();
      unsubscribeState();
      if (this.port !== port) return;
      if (this.openBookId) this.onSessionEvent({ type: 'close', bookId: this.openBookId });
      this.port = undefined;
      this.controls = undefined;
      this.sessionCache = undefined;
      this.notifySession();
      this.host.notify();
    };
    this.detachCurrent = detach;
    return detach;
  }

  private detach(): void {
    const detach = this.detachCurrent;
    this.detachCurrent = undefined;
    detach?.();
  }

  currentBook(): BookInfo | undefined {
    const book = this.port?.getState().book;
    return book && this.openBookId === book.id ? toBookInfo(book) : undefined;
  }

  private onSessionEvent(event: ReaderSessionEvent): void {
    switch (event.type) {
      case 'open':
        this.openBookId = event.bookId;
        this.enqueue('open', () => ({ book: this.bookInfo(event.bookId) }));
        void this.host.trigger('onReaderOpen');
        break;
      case 'ready':
      case 'locationChange':
      case 'layoutChange': {
        const location = event.location;
        this.enqueue(event.type, () => ({
          book: this.bookInfo(event.bookId),
          location: toLocation(event.bookId, location),
        }));
        break;
      }
      case 'chapterChange':
        this.enqueue('chapterChange', () => ({
          book: this.bookInfo(event.bookId),
          previous: event.previous && { ref: event.previous.href, title: event.previous.title },
          chapter: event.chapter && { ref: event.chapter.href, title: event.chapter.title },
        }));
        break;
      case 'paginationChange':
        this.enqueue('paginationChange', () => ({
          book: this.bookInfo(event.bookId),
          totalPages: event.totalPages,
          complete: event.complete,
        }));
        break;
      case 'close': {
        if (this.openBookId !== event.bookId) return;
        const book = this.bookInfo(event.bookId);
        const location = event.location && toLocation(event.bookId, event.location);
        this.openBookId = undefined;
        this.enqueue('close', () => ({ book, location }));
        this.clearSessionData();
        break;
      }
    }
  }

  private onSessionState(): void {
    const state = this.port?.getState();
    if (state && state.hasSelection !== this.hasSelection) {
      this.hasSelection = state.hasSelection;
      const bookId = this.openBookId;
      if (bookId) {
        const hasSelection = state.hasSelection;
        this.enqueue('selectionChange', () => ({ book: this.bookInfo(bookId), hasSelection }));
      }
    }
    this.notifySession();
  }

  private notifySession(): void {
    for (const listener of [...this.sessionListeners]) listener();
  }

  private bookInfo(bookId: string): BookInfo {
    const book = this.port?.getState().book;
    return book?.id === bookId ? toBookInfo(book) : { ref: bookId, title: '' };
  }

  private enqueue(name: ReaderEventName, payload: () => ReaderEvents[ReaderEventName]): void {
    this.queue.push({ name, payload });
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    // Batched on idle: plugin listeners never run inside the reader's own effects.
    this.host.schedule(() => this.flush());
  }

  private flush(): void {
    this.flushScheduled = false;
    const events = this.queue;
    this.queue = [];
    // Consecutive location reports collapse to the newest one.
    const coalesced = events.filter(
      (event, index) => event.name !== 'locationChange' || events[index + 1]?.name !== 'locationChange',
    );
    for (const event of coalesced) {
      const payload = event.payload();
      for (const [entry, generation] of this.host.activeGenerations()) {
        this.dispatch(entry, generation, event.name, payload);
      }
    }
  }

  private dispatch(entry: PluginEntry, generation: PluginGeneration, name: ReaderEventName, payload: unknown): void {
    if (!hasPermission(entry.plugin.manifest, 'reader.events')) return;
    for (const listener of [...(generation.readerListeners.get(name) ?? [])]) {
      try {
        const result = listener(payload) as unknown;
        if (result instanceof Promise) {
          result.catch((error: unknown) =>
            this.host.log(entry, 'error', `${name} listener failed: ${pluginErrorMessage(error)}`),
          );
        }
      } catch (error) {
        this.host.log(entry, 'error', `${name} listener failed: ${pluginErrorMessage(error)}`);
      }
    }
  }

  /** Replays the open session to a plugin that activated after it started. */
  generationCommitted(entry: PluginEntry, generation: PluginGeneration): void {
    const state = this.port?.getState();
    const bookId = this.openBookId;
    if (!state || !bookId || state.lifecycle === 'closed') return;
    this.host.schedule(() => {
      if (generation.disposed || this.openBookId !== bookId) return;
      const current = this.port?.getState();
      this.dispatch(entry, generation, 'open', { book: this.bookInfo(bookId) });
      if (current?.lifecycle === 'open' && current.location) {
        this.dispatch(entry, generation, 'ready', {
          book: this.bookInfo(bookId),
          location: toLocation(bookId, current.location),
        });
      }
    });
  }

  generationEnded(pluginId: string): void {
    let changed = false;
    for (const [key, layer] of this.layers) {
      if (layer.pluginId !== pluginId) continue;
      if (layer.timer) clearTimeout(layer.timer);
      this.layers.delete(key);
      changed = true;
    }
    for (const [ref, grant] of this.grants) if (grant.pluginId === pluginId) this.grants.delete(ref);
    if (changed) this.decorationsChanged();
  }

  private clearSessionData(): void {
    this.grants.clear();
    let changed = false;
    for (const layer of this.layers.values()) {
      if (layer.timer) clearTimeout(layer.timer);
      layer.timer = undefined;
      layer.pending = undefined;
      if (layer.decorations.length > 0) {
        layer.decorations = [];
        changed = true;
      }
    }
    if (changed) this.decorationsChanged();
  }

  private decorationsChanged(): void {
    this.decorationsCache = undefined;
    this.host.notify();
  }

  getDecorations(): readonly ReaderExtensionDecoration[] {
    this.decorationsCache ??= [...this.layers.values()].flatMap((layer) => layer.decorations);
    return this.decorationsCache;
  }

  openPanel(entry: PluginEntry, panelId: string): void {
    if (!this.controls?.openPanel(pluginPanelKey(entry.plugin.id, panelId))) {
      this.host.log(entry, 'warn', `Panel ${panelId} cannot open outside the reader`);
    }
  }

  closePanel(entry: PluginEntry, panelId?: string): void {
    this.controls?.closePanel(panelId === undefined ? undefined : pluginPanelKey(entry.plugin.id, panelId));
  }

  /** Freezes the selection for one plugin action; the plugin reads it through the returned reference. */
  grantSelection(pluginId: string, selection: ReaderExtensionSelection): SelectionSnapshot {
    const bookId = this.openBookId;
    if (!bookId) throw new LunarPluginError('NO_ACTIVE_SESSION', 'No book is open');
    if (selection.text.length > READER_BRIDGE_LIMITS.selectionCharacters) {
      throw new LunarPluginError('QUOTA_EXCEEDED', 'The selection is too long');
    }
    const snapshot: SelectionSnapshot = {
      selectionRef: `sel:${(this.grantCounter += 1)}`,
      text: selection.text,
      range: encodeRangeRef({
        bookId,
        href: selection.href,
        text: selection.text,
        frameKey: selection.frameKey,
        revisionId: selection.revisionId,
        range: selection.range,
        sourceRange: selection.sourceRange,
      }),
      chapterRef: selection.href,
      chapterTitle: selection.chapterTitle,
      capturedAt: this.host.now(),
    };
    this.grants.set(snapshot.selectionRef, {
      pluginId,
      snapshot,
      expiresAt: this.host.now() + READER_BRIDGE_LIMITS.selectionGrantMs,
    });
    while (this.grants.size > READER_BRIDGE_LIMITS.selectionGrants) {
      this.grants.delete(this.grants.keys().next().value!);
    }
    return snapshot;
  }

  runSelectionMenu(items: readonly SelectionMenuItem[], book: BookInfo) {
    const origins = new Map<SelectionMenuItem, string>();
    let current = items;
    for (const [entry, generation] of this.host.activeGenerations()) {
      if (!hasPermission(entry.plugin.manifest, 'reader.selection.read')) continue;
      for (const handler of generation.interceptors.selectionMenu) {
        const input = current;
        const output = this.runInterceptor(entry, generation, handler, () => handler(input, { book }));
        if (!output) continue;
        const accepted = acceptSelectionItems(input, output, items);
        if (!accepted) {
          this.host.log(entry, 'warn', 'selectionMenu returned invalid items and was ignored');
          continue;
        }
        for (const item of accepted) {
          if (!item.builtin && !input.includes(item)) origins.set(item, entry.plugin.id);
        }
        current = accepted;
      }
    }
    return { items: current, origins };
  }

  runToolbarItems(items: readonly ToolbarItem[], book: BookInfo): readonly ToolbarItem[] {
    let current = items;
    for (const [entry, generation] of this.host.activeGenerations()) {
      for (const handler of generation.interceptors.toolbarItems) {
        const input = current;
        const output = this.runInterceptor(entry, generation, handler, () => handler(input, { book }));
        if (!output) continue;
        const known = new Set(input.map((item) => item.id));
        if (!Array.isArray(output) || output.some((item) => !known.has(item?.id))) {
          this.host.log(entry, 'warn', 'toolbarItems may only hide or reorder items and was ignored');
          continue;
        }
        current = [
          ...new Map(output.map((item) => [item.id, input.find((original) => original.id === item.id)!])).values(),
        ];
      }
    }
    return current;
  }

  private runInterceptor<T>(
    entry: PluginEntry,
    generation: PluginGeneration,
    handler: ReaderInterceptors[keyof ReaderInterceptors],
    run: () => T,
  ): T | undefined {
    const overruns = generation.interceptorOverruns.get(handler) ?? 0;
    if (overruns >= READER_BRIDGE_LIMITS.interceptorOverrunsBeforeSkip) return undefined;
    const startedAt = this.host.now();
    try {
      return run();
    } catch (error) {
      this.host.log(entry, 'error', `Interceptor failed: ${pluginErrorMessage(error)}`);
      return undefined;
    } finally {
      const elapsed = this.host.now() - startedAt;
      if (elapsed > READER_BRIDGE_LIMITS.interceptorBudgetMs) {
        generation.interceptorOverruns.set(handler, overruns + 1);
        this.host.log(
          entry,
          'warn',
          `Interceptor took ${elapsed} ms; the budget is ${READER_BRIDGE_LIMITS.interceptorBudgetMs} ms`,
        );
      }
    }
  }

  private sessionInfo(): ReaderSessionInfo | undefined {
    const state = this.port?.getState();
    if (!state) return undefined;
    if (this.sessionCache?.state === state) return this.sessionCache.info;
    const info: ReaderSessionInfo | undefined =
      state.lifecycle === 'closed' || !state.book
        ? undefined
        : {
            book: toBookInfo(state.book),
            phase: state.lifecycle,
            location: state.location && toLocation(state.book.id, state.location),
            interaction: state.interaction,
            hasSelection: state.hasSelection,
          };
    this.sessionCache = { state, info };
    return info;
  }

  private requirePort(): ReaderSessionPort {
    if (!this.port || !this.openBookId) throw new LunarPluginError('NO_ACTIVE_SESSION', 'No book is open');
    return this.port;
  }

  createApi(entry: PluginEntry, generation: PluginGeneration): ReaderAPI {
    const live = () => generation.assertLive();
    const allow = (permission: Parameters<typeof hasPermission>[1]) => {
      live();
      this.host.assertPermission(entry, permission);
    };
    const track = (cleanup: () => void) => generation.track(cleanup);

    return {
      on: (event, listener) => {
        allow('reader.events');
        if (!ReaderEventNames.has(event))
          throw new LunarPluginError('INVALID_ARGUMENT', `Unknown reader event ${String(event)}`);
        if (typeof listener !== 'function')
          throw new LunarPluginError('INVALID_ARGUMENT', 'listener must be a function');
        const listeners = generation.readerListeners.get(event) ?? new Set();
        const wrapped = listener as (payload: unknown) => void;
        listeners.add(wrapped);
        generation.readerListeners.set(event, listeners);
        return track(() => listeners.delete(wrapped));
      },

      intercept: (point, handler) => {
        live();
        if (point === 'selectionMenu') this.host.assertPermission(entry, 'reader.selection.read');
        else if (point !== 'toolbarItems')
          throw new LunarPluginError('INVALID_ARGUMENT', `Unknown interceptor ${String(point)}`);
        if (typeof handler !== 'function') throw new LunarPluginError('INVALID_ARGUMENT', 'handler must be a function');
        const handlers = generation.interceptors[point] as Set<typeof handler>;
        handlers.add(handler);
        this.host.notify();
        return generation.track(
          () => handlers.delete(handler),
          () => this.host.notify(),
        );
      },

      session: {
        current: () => {
          allow('reader.events');
          return this.sessionInfo();
        },
        subscribe: (listener) => {
          allow('reader.events');
          const wrapped = () => {
            try {
              listener();
            } catch (error) {
              this.host.log(entry, 'error', `Session listener failed: ${pluginErrorMessage(error)}`);
            }
          };
          this.sessionListeners.add(wrapped);
          return track(() => this.sessionListeners.delete(wrapped));
        },
        getToc: async () => {
          allow('reader.events');
          return this.requirePort().getToc().map(toTocItem);
        },
        getVisibleText: async (): Promise<readonly TextSegment[]> => {
          allow('reader.content.read');
          const port = this.requirePort();
          const bookId = this.openBookId!;
          const visible = port.getVisibleText();
          if (!visible) return [];
          return visible.segments.map((segment) => ({
            text: segment.text,
            chapterRef: visible.href,
            key: segment.sourceRange && createTextSegmentKey(bookId, visible.href, segment.sourceRange),
            range: encodeRangeRef({
              bookId,
              href: visible.href,
              text: segment.text,
              frameKey: visible.frameKey,
              revisionId: visible.revisionId,
              range: segment.range,
              sourceRange: segment.sourceRange,
            }),
          }));
        },
        getChapterText: async () => {
          allow('reader.content.read');
          throw new LunarPluginError('CAPABILITY_UNAVAILABLE', 'Chapter text needs the reader.chapterText capability');
        },
        readSelection: async (selectionRef) => {
          allow('reader.selection.read');
          const grant = this.grants.get(selectionRef);
          if (!grant || grant.pluginId !== entry.plugin.id || grant.expiresAt < this.host.now()) {
            throw new LunarPluginError('GRANT_EXPIRED', 'The selection is no longer available');
          }
          return grant.snapshot;
        },
        search: async (query, options = {}): Promise<readonly SearchHit[]> => {
          allow('reader.content.read');
          if (typeof query !== 'string' || query.length === 0 || query.length > 200) {
            throw new LunarPluginError('INVALID_ARGUMENT', 'The query must be 1 to 200 characters');
          }
          const port = this.requirePort();
          const bookId = this.openBookId!;
          const response = await port.search({
            query,
            caseSensitive: options.caseSensitive === true,
            limit: Math.max(1, Math.min(READER_BRIDGE_LIMITS.searchResults, Math.floor(options.limit ?? 20))),
          });
          if (options.signal?.aborted || generation.disposed) {
            throw new LunarPluginError('CANCELLED', 'The search was cancelled');
          }
          return response.results.map((result) => ({
            context: result.context,
            locator: result.locator && encodeLocatorRef({ bookId, locator: result.locator }),
            chapterRef: result.locator?.manifestHref,
          }));
        },
        goTo: async (target: NavigationTarget) => {
          allow('reader.navigate');
          const port = this.requirePort();
          if ('locator' in target) {
            const ref = decodeLocatorRef(target.locator);
            if (!ref) throw new LunarPluginError('INVALID_ARGUMENT', 'The locator is invalid');
            if (ref.bookId !== this.openBookId)
              throw new LunarPluginError('ANCHOR_UNAVAILABLE', 'The locator belongs to another book');
            return port.goToLocator(ref.locator);
          }
          if ('chapterRef' in target) {
            if (typeof target.chapterRef !== 'string' || !target.chapterRef) {
              throw new LunarPluginError('INVALID_ARGUMENT', 'The chapter reference is invalid');
            }
            return port.goToChapter(target.chapterRef);
          }
          if (typeof target.progress !== 'number' || !Number.isFinite(target.progress)) {
            throw new LunarPluginError('INVALID_ARGUMENT', 'progress must be a number from 0 to 1');
          }
          return port.goToProgression(target.progress);
        },
        next: async () => {
          allow('reader.navigate');
          return this.requirePort().next();
        },
        previous: async () => {
          allow('reader.navigate');
          return this.requirePort().previous();
        },
      },

      decorations: {
        create: (layerId): DecorationLayer => {
          allow('reader.decorations');
          if (typeof layerId !== 'string' || !LayerId.test(layerId)) {
            throw new LunarPluginError('INVALID_ARGUMENT', 'Layer ids are 1 to 32 lowercase letters, digits or "-"');
          }
          const key = `${entry.plugin.id}\u0000${layerId}`;
          if (this.layers.has(key)) throw new LunarPluginError('INVALID_ARGUMENT', `Layer ${layerId} already exists`);
          const owned = [...this.layers.values()].filter((layer) => layer.pluginId === entry.plugin.id).length;
          if (owned >= READER_BRIDGE_LIMITS.layersPerPlugin) {
            throw new LunarPluginError(
              'QUOTA_EXCEEDED',
              `A plugin can own ${READER_BRIDGE_LIMITS.layersPerPlugin} layers`,
            );
          }
          const layer: LayerState = { pluginId: entry.plugin.id, decorations: [], lastAppliedAt: 0 };
          this.layers.set(key, layer);
          const apply = (decorations: readonly ReaderExtensionDecoration[]) => {
            if (this.layers.get(key) !== layer) return;
            const now = this.host.now();
            const wait = layer.lastAppliedAt + READER_BRIDGE_LIMITS.layerUpdateIntervalMs - now;
            if (wait > 0) {
              layer.pending = decorations;
              layer.timer ??= setTimeout(() => {
                layer.timer = undefined;
                const pending = layer.pending;
                layer.pending = undefined;
                if (pending) apply(pending);
              }, wait);
              return;
            }
            layer.lastAppliedAt = now;
            layer.decorations = decorations;
            this.decorationsChanged();
          };
          const remove = generation.track(() => {
            if (layer.timer) clearTimeout(layer.timer);
            if (this.layers.get(key) === layer) {
              this.layers.delete(key);
              this.decorationsChanged();
            }
          });
          return {
            set: (decorations: readonly Decoration[]) => {
              live();
              apply(this.toDecorations(layerId, entry.plugin.id, decorations));
            },
            clear: () => {
              live();
              apply([]);
            },
            dispose: () => remove.dispose(),
          };
        },
      },
    };
  }

  private toDecorations(
    layerId: string,
    pluginId: string,
    decorations: readonly Decoration[],
  ): readonly ReaderExtensionDecoration[] {
    if (!Array.isArray(decorations) || decorations.length > READER_BRIDGE_LIMITS.decorationsPerLayer) {
      throw new LunarPluginError(
        'QUOTA_EXCEEDED',
        `A layer holds up to ${READER_BRIDGE_LIMITS.decorationsPerLayer} decorations`,
      );
    }
    const bookId = this.openBookId;
    return decorations.flatMap((decoration, index) => {
      if (!DecorationStyles.has(decoration?.style) || !DecorationColors.has(decoration?.color)) {
        throw new LunarPluginError('INVALID_ARGUMENT', `Decoration ${index} has an unknown style or color`);
      }
      const ref = decodeRangeRef(decoration.range);
      if (!ref) throw new LunarPluginError('INVALID_ARGUMENT', `Decoration ${index} has an invalid range`);
      // Ranges from a previous book are dropped rather than painted on unrelated text.
      if (ref.bookId !== bookId) return [];
      return [
        {
          key: `${pluginId}/${layerId}/${index}`,
          href: ref.href,
          frameKey: ref.frameKey,
          revisionId: ref.revisionId,
          range: ref.range,
          sourceRange: ref.sourceRange,
          text: ref.text,
          style: decoration.style,
          color: decoration.color,
        },
      ];
    });
  }
}

/**
 * Accepts an interceptor result when built-in items keep their identity and
 * every new item is complete. Built-in items may be removed or reordered only.
 */
function acceptSelectionItems(
  input: readonly SelectionMenuItem[],
  output: unknown,
  original: readonly SelectionMenuItem[],
): readonly SelectionMenuItem[] | undefined {
  if (!Array.isArray(output)) return undefined;
  const builtinIds = new Set(original.filter((item) => item.builtin).map((item) => item.id));
  const ids = new Set<string>();
  let added = 0;
  for (const item of output as SelectionMenuItem[]) {
    if (!item || typeof item.id !== 'string' || typeof item.title !== 'string' || ids.has(item.id)) return undefined;
    ids.add(item.id);
    if (item.builtin || builtinIds.has(item.id)) {
      if (!original.includes(item)) return undefined;
      continue;
    }
    if (typeof item.onPress !== 'function') return undefined;
    if (!input.includes(item)) added += 1;
  }
  const existing = input.filter((item) => !item.builtin).length;
  return existing + added > READER_BRIDGE_LIMITS.pluginSelectionItems ? undefined : (output as SelectionMenuItem[]);
}

function toBookInfo(book: ReaderSessionBook): BookInfo {
  return { ref: book.id, title: book.title, author: book.author, language: book.language };
}

function toLocation(bookId: string, location: ReaderSessionLocation): ReaderLocation {
  return {
    locator: location.locator && encodeLocatorRef({ bookId, locator: location.locator }),
    chapter: location.chapter && { ref: location.chapter.href, title: location.chapter.title },
    progress: location.progression,
    page: location.page,
    totalPages: location.totalPages,
  };
}

function toTocItem(entry: ReaderTocEntry): TocItem {
  return { title: entry.label, chapterRef: entry.href, children: entry.children.map(toTocItem) };
}
