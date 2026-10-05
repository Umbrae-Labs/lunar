import type { SkFont } from '@shopify/react-native-skia';

import type {
  ReaderFontFace,
  ReaderLayoutRequest,
  ReaderLocator,
  ReaderOpenRequest,
  ReaderOpenResult,
  ReaderPosition,
  ReaderPreparedAdjacent,
  ReaderPublicationView,
  ReaderRenderFrame,
  ReaderSnapshot,
} from '../../contracts';
import { createLunarRitoPinnedFonts } from '../../rito/pinned-font';
import { LunarSkiaFontRegistry } from '../../skia/fonts/font-registry';
import { SkiaImageCache } from '../../skia/images/image-decoder';
import { SkiaPictureCompiler, type CompiledReaderPicture } from '../../skia/rendering/picture-compiler';
import { LunarSkiaTextMeasurer } from '../../skia/text/text-measurer';
import { LUNAR_READER_FONT_FAMILY } from '../../typography';
import { FrameCache } from '../cache/frame-cache';
import { ReaderImageByteCache } from '../cache/reader-image-cache';
import type { ReaderRuntime, ReaderSnapshotListener } from './reader-runtime';
import type { ReaderBackgroundPaginationBackend, ReaderPaginationBackend } from '../pagination/pagination-backend';
import type { RitoNativePaginationOpenOptions } from '../pagination/rito-native-pagination-backend';
import {
  readerDiagnostic,
  readerPerformanceActivity,
  readerPerformanceEnd,
  readerPerformanceId,
  readerPerformanceMark,
  readerPerformanceStart,
} from './performance';

export type ReaderBookDataLoader = (request: ReaderOpenRequest) => Promise<ArrayBuffer>;

export type ReaderTurnDirection = 'next' | 'previous';

export interface ReaderPreparedTurn {
  readonly performanceId?: string;
  readonly id: number;
  readonly revisionId: number;
  readonly direction: ReaderTurnDirection;
  readonly sourceSnapshotSpreadIndex: number;
  readonly sourcePreparedSpreadIndex: number;
  readonly targetSpreadIndex: number;
  readonly targetRenderId: number;
  readonly publicationTurn?: ReaderPreparedAdjacent;
}

interface RetainedReaderPicture {
  readonly renderId: number;
  readonly compiled: CompiledReaderPicture;
  readonly imageLease: { release(): void };
  readonly sourceKey?: string;
  readonly renderKey?: string;
}

// A turn across a chapter boundary can visit several local spreads before it
// returns to the original chapter. Keep that neighborhood available for the
// common back-and-forth gesture while retaining a bounded native resource set.
const READER_PICTURE_CACHE_CAP = 12;

export class LunarReaderRuntime implements ReaderRuntime {
  private snapshot: ReaderSnapshot = {
    phase: 'idle',
    revisionId: 0,
    spreadIndex: 0,
  };
  private readonly listeners = new Set<ReaderSnapshotListener>();
  private readonly pictures = new FrameCache<RetainedReaderPicture>(READER_PICTURE_CACHE_CAP, (retained) =>
    this.deferSkiaCleanup(() => {
      if (retained.renderKey && this.pictureRenderIdsByRenderKey.get(retained.renderKey) === retained.renderId) {
        this.pictureRenderIdsByRenderKey.delete(retained.renderKey);
      }
      for (const [slotKey, renderId] of this.pictureRenderIds) {
        if (renderId === retained.renderId) this.pictureRenderIds.delete(slotKey);
      }
      this.pictureCompiler.dispose(retained.compiled);
      retained.imageLease.release();
    }),
  );
  private readonly pictureCompiler = new SkiaPictureCompiler();
  private publication?: ReaderPublicationView;
  private fontRegistry?: LunarSkiaFontRegistry;
  /** Face Skia-owned chrome text paints with, kept across sessions. */
  private chromeFontFace?: ReaderFontFace;
  private chromeFontFamily: string = LUNAR_READER_FONT_FAMILY;
  private chromeFontEpoch = 0;
  private readonly chromeFontListeners = new Set<() => void>();
  private textMeasurer?: LunarSkiaTextMeasurer;
  private imageCache?: SkiaImageCache;
  private readonly imageByteCache = new ReaderImageByteCache();
  private readonly pictureRenderIds = new Map<string, number>();
  private readonly pictureRenderIdsByRenderKey = new Map<string, number>();
  private request?: ReaderOpenRequest;
  private operation = 0;
  private abortController?: AbortController;
  private paginationComplete = false;
  private backgroundScheduled = false;
  private readonly backgroundSuspensions = new Set<symbol>();
  private foregroundQueued = 0;
  // Owned by the serialized foreground action, never by a global async scope.
  private performanceId?: string;
  private renderId = 0;
  private preparedTurnId = 0;
  private preparedTurn?: ReaderPreparedTurn;
  /**
   * Foreground operations share one queue. Background work has its own lane;
   * the publication queue and native compare-and-swap checks keep its result
   * ordered with a turn while allowing a pending turn to take precedence.
   */
  private actionTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly loadData: ReaderBookDataLoader,
    private readonly paginationBackend: ReaderPaginationBackend,
  ) {}

  getSnapshot(): ReaderSnapshot {
    return this.snapshot;
  }

  /** Navigation may finish before the retained page animation is presented. */
  suspendBackgroundPagination(): () => void {
    const token = Symbol();
    this.backgroundSuspensions.add(token);
    return () => {
      if (this.backgroundSuspensions.delete(token)) this.scheduleBackground(this.operation);
    };
  }

  subscribe(listener: ReaderSnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async open(request: ReaderOpenRequest): Promise<ReaderOpenResult> {
    const operation = this.beginOperation();
    const openStartedAt = readerPerformanceStart('reader.open');
    await this.releaseResources();
    this.request = request;
    this.emit({
      phase: 'opening',
      bookId: request.bookId,
      revisionId: this.snapshot.revisionId + 1,
      spreadIndex: 0,
    });

    try {
      const data = await this.loadData(request);
      readerPerformanceMark('reader.bookBytesReady', `bytes=${data.byteLength}`);
      this.assertCurrent(operation);
      return await this.loadCurrentRequest(
        request,
        data,
        request.restorePosition?.progression ?? 0,
        operation,
        'paginating',
      );
    } catch (error) {
      await this.fail(operation, error);
      throw error;
    } finally {
      readerPerformanceEnd('reader.open', openStartedAt);
    }
  }

  async updateLayout(request: ReaderLayoutRequest): Promise<ReaderSnapshot> {
    if (!this.request) {
      throw new Error('A book must be open before updating its layout.');
    }
    const progression = this.snapshot.position?.progression ?? 0;
    const restorePosition = this.snapshot.position ?? this.request.restorePosition;
    const operation = this.beginOperation();
    const openRequest = { ...this.request, ...request, restorePosition };
    this.request = openRequest;
    this.emit({
      ...this.snapshot,
      phase: 'reflowing',
      revisionId: this.snapshot.revisionId + 1,
      errorMessage: undefined,
    });
    await this.releaseResources();

    try {
      const data = await this.loadData(openRequest);
      readerPerformanceMark('reader.bookBytesReady', `bytes=${data.byteLength}`);
      this.assertCurrent(operation);
      const result = await this.loadCurrentRequest(openRequest, data, progression, operation, 'reflowing');
      return result.snapshot;
    } catch (error) {
      await this.fail(operation, error);
      throw error;
    }
  }

  async goToSpread(spreadIndex: number): Promise<ReaderSnapshot> {
    return this.enqueueNavigation(() => this.resolveSpreadTarget(spreadIndex));
  }

  async prepareAdjacent(
    direction: ReaderTurnDirection,
    performanceId?: string,
  ): Promise<ReaderPreparedTurn | undefined> {
    if (!this.publication || this.snapshot.phase !== 'ready') return undefined;
    return this.enqueueForeground(() => this.prepareAdjacentWithinForeground(direction), 'prepare', performanceId);
  }

  private async prepareAdjacentWithinForeground(
    direction: ReaderTurnDirection,
  ): Promise<ReaderPreparedTurn | undefined> {
    const publication = this.publication;
    const sourceSnapshot = this.snapshot;
    if (!publication || sourceSnapshot.phase !== 'ready') return undefined;
    if (publication.canNavigate?.(direction) === false) return undefined;
    const existing = this.preparedTurn;
    if (
      existing &&
      existing.revisionId === sourceSnapshot.revisionId &&
      existing.sourceSnapshotSpreadIndex === sourceSnapshot.spreadIndex &&
      existing.direction === direction
    ) {
      return existing;
    }
    if (existing) return undefined;
    const preparedTurnId = ++this.preparedTurnId;
    const operation = this.operation;
    const delta = direction === 'next' ? 1 : -1;
    let publicationTurn: ReaderPreparedAdjacent | undefined;
    let targetSpreadIndex = sourceSnapshot.spreadIndex + delta;
    let sourcePreparedSpreadIndex = sourceSnapshot.spreadIndex;
    try {
      if (publication.prepareAdjacent) {
        const startedAt = readerPerformanceStart();
        try {
          publicationTurn = await publication.prepareAdjacent(sourceSnapshot.spreadIndex, direction);
        } finally {
          readerPerformanceEnd('reader.adjacent.resolve', startedAt, { workId: this.performanceId, direction });
        }
        if (!publicationTurn) return undefined;
        if (!publication.commitPreparedAdjacent || !publication.cancelPreparedAdjacent) {
          throw new Error('Prepared publication turns require commit and cancel operations.');
        }
        targetSpreadIndex = publicationTurn.targetSpreadIndex;
        sourcePreparedSpreadIndex = publicationTurn.sourceSpreadIndex;
      } else {
        targetSpreadIndex =
          publication.getAdjacentSpreadIndex?.(sourceSnapshot.spreadIndex, direction) ?? targetSpreadIndex;
        sourcePreparedSpreadIndex = targetSpreadIndex - delta;
      }
      readerDiagnostic(
        'turn.runtime.prepare.begin',
        () =>
          `prepared=${preparedTurnId} direction=${direction} source=${describeSnapshot(sourceSnapshot)} sourcePreparedSpread=${sourcePreparedSpreadIndex} targetSpread=${targetSpreadIndex} candidate=${publicationTurn?.id ?? 'legacy'}`,
      );
      await this.preparePicture(targetSpreadIndex, operation);
      this.assertCurrent(operation);
      if (
        this.snapshot.revisionId !== sourceSnapshot.revisionId ||
        this.snapshot.spreadIndex !== sourceSnapshot.spreadIndex
      ) {
        if (publicationTurn) {
          await publication.cancelPreparedAdjacent?.(publicationTurn, sourceSnapshot.spreadIndex);
          await this.preparePicture(sourceSnapshot.spreadIndex, operation);
        }
        return undefined;
      }
      const targetRenderId = this.pictureRenderIds.get(pictureSlotKey(sourceSnapshot.revisionId, targetSpreadIndex));
      if (targetRenderId === undefined) {
        if (publicationTurn) {
          await publication.cancelPreparedAdjacent?.(publicationTurn, sourceSnapshot.spreadIndex);
          await this.preparePicture(sourceSnapshot.spreadIndex, operation);
        } else {
          await this.restorePreparedSource(sourcePreparedSpreadIndex, sourceSnapshot.spreadIndex, operation);
        }
        return undefined;
      }
      const preparedTurn: ReaderPreparedTurn = {
        performanceId: this.performanceId,
        id: preparedTurnId,
        revisionId: sourceSnapshot.revisionId,
        direction,
        sourceSnapshotSpreadIndex: sourceSnapshot.spreadIndex,
        sourcePreparedSpreadIndex,
        targetSpreadIndex,
        targetRenderId,
        publicationTurn,
      };
      this.preparedTurn = preparedTurn;
      readerDiagnostic(
        'turn.runtime.prepare.ready',
        () =>
          `prepared=${preparedTurnId} direction=${direction} target=${preparedTurn.revisionId}:${preparedTurn.targetSpreadIndex}:${preparedTurn.targetRenderId}`,
      );
      return preparedTurn;
    } catch (error) {
      readerDiagnostic(
        'turn.runtime.prepare.error',
        () =>
          `prepared=${preparedTurnId} direction=${direction} targetSpread=${targetSpreadIndex} error=${describeError(error)}`,
      );
      if (publicationTurn) {
        await publication.cancelPreparedAdjacent?.(publicationTurn, sourceSnapshot.spreadIndex).catch(() => undefined);
        await this.preparePicture(sourceSnapshot.spreadIndex, operation).catch(() => undefined);
      } else {
        await this.restorePreparedSource(sourcePreparedSpreadIndex, sourceSnapshot.spreadIndex, operation).catch(
          () => undefined,
        );
      }
      return undefined;
    }
  }

  /** Compile neighboring Pictures without publishing or retaining a candidate. */
  async warmAdjacentPictures(revisionId: number, spreadIndex: number): Promise<void> {
    await this.enqueueForeground(async () => {
      for (const direction of ['next', 'previous'] as const) {
        if (
          this.snapshot.phase !== 'ready' ||
          this.snapshot.revisionId !== revisionId ||
          this.snapshot.spreadIndex !== spreadIndex ||
          this.preparedTurn ||
          this.foregroundQueued > 1
        )
          return;
        const prepared = await this.prepareAdjacentWithinForeground(direction);
        if (prepared) await this.cancelPreparedTurnWithinForeground(prepared);
      }
    }, 'warm');
  }

  async commitPreparedTurn(preparedTurn: ReaderPreparedTurn): Promise<ReaderSnapshot> {
    return this.enqueueForeground(
      async () => {
        if (this.preparedTurn?.id !== preparedTurn.id) {
          readerDiagnostic(
            'turn.runtime.commit.stale',
            () =>
              `prepared=${preparedTurn.id} active=${this.preparedTurn?.id ?? 'none'} snapshot=${describeSnapshot(this.snapshot)}`,
          );
          return this.snapshot;
        }
        readerDiagnostic(
          'turn.runtime.commit.begin',
          () =>
            `prepared=${preparedTurn.id} target=${preparedTurn.revisionId}:${preparedTurn.targetSpreadIndex}:${preparedTurn.targetRenderId} snapshot=${describeSnapshot(this.snapshot)}`,
        );
        try {
          if (preparedTurn.publicationTurn) {
            const publication = this.publication;
            if (!publication?.commitPreparedAdjacent) throw new Error('Prepared publication commit is unavailable.');
            const startedAt = readerPerformanceStart();
            try {
              await publication.commitPreparedAdjacent(preparedTurn.publicationTurn);
            } finally {
              readerPerformanceEnd('reader.adjacent.adopt', startedAt, { workId: this.performanceId });
            }
          }
          const snapshot = await this.showSpread(preparedTurn.targetSpreadIndex);
          readerDiagnostic(
            'turn.runtime.commit.ready',
            () => `prepared=${preparedTurn.id} snapshot=${describeSnapshot(snapshot)}`,
          );
          return snapshot;
        } finally {
          if (this.preparedTurn?.id === preparedTurn.id) this.preparedTurn = undefined;
        }
      },
      'commit',
      preparedTurn.performanceId,
    );
  }

  async cancelPreparedTurn(preparedTurn: ReaderPreparedTurn): Promise<void> {
    await this.enqueueForeground(
      () => this.cancelPreparedTurnWithinForeground(preparedTurn),
      'cancel',
      preparedTurn.performanceId,
    );
  }

  private async cancelPreparedTurnWithinForeground(preparedTurn: ReaderPreparedTurn): Promise<void> {
    if (this.preparedTurn?.id !== preparedTurn.id) {
      readerDiagnostic(
        'turn.runtime.cancel.stale',
        () =>
          `prepared=${preparedTurn.id} active=${this.preparedTurn?.id ?? 'none'} snapshot=${describeSnapshot(this.snapshot)}`,
      );
      return;
    }
    const operation = this.operation;
    readerDiagnostic(
      'turn.runtime.cancel.begin',
      () =>
        `prepared=${preparedTurn.id} sourceSnapshotSpread=${preparedTurn.sourceSnapshotSpreadIndex} sourcePreparedSpread=${preparedTurn.sourcePreparedSpreadIndex}`,
    );
    try {
      if (preparedTurn.publicationTurn) {
        const publication = this.publication;
        if (!publication?.cancelPreparedAdjacent) throw new Error('Prepared publication cancellation is unavailable.');
        await publication.cancelPreparedAdjacent(preparedTurn.publicationTurn, preparedTurn.sourceSnapshotSpreadIndex);
        await this.preparePicture(preparedTurn.sourceSnapshotSpreadIndex, operation);
      } else {
        await this.restorePreparedSource(
          preparedTurn.sourcePreparedSpreadIndex,
          preparedTurn.sourceSnapshotSpreadIndex,
          operation,
        );
      }
      readerDiagnostic(
        'turn.runtime.cancel.ready',
        () => `prepared=${preparedTurn.id} snapshot=${describeSnapshot(this.snapshot)}`,
      );
    } finally {
      if (this.preparedTurn?.id === preparedTurn.id) this.preparedTurn = undefined;
    }
  }

  async goToToc(href: string): Promise<ReaderSnapshot> {
    return this.enqueueAsyncNavigation(async () => {
      const target = await this.publication?.resolveToc(href);
      if (target === undefined) {
        throw new RangeError(`The table-of-contents target ${href} was not found.`);
      }
      this.invalidatePicture(target);
      return target;
    });
  }

  async goToLocator(locator: ReaderLocator): Promise<ReaderSnapshot> {
    return this.enqueueAsyncNavigation(async () => {
      if (this.preparedTurn) throw new Error('Finish the active page turn before navigating.');
      const operation = this.operation;
      const target = await this.publication?.resolveLocator?.(locator);
      this.assertCurrent(operation);
      if (target === undefined) throw new RangeError('The saved reading location was not found.');
      this.invalidatePicture(target);
      return target;
    });
  }

  async next(performanceId?: string): Promise<ReaderSnapshot> {
    return this.enqueueNavigation(() => {
      const allowed = this.publication?.canNavigate?.('next') !== false;
      const target = allowed
        ? (this.publication?.getAdjacentSpreadIndex?.(this.snapshot.spreadIndex, 'next') ??
          this.snapshot.spreadIndex + 1)
        : this.snapshot.spreadIndex;
      readerDiagnostic(
        'runtime.next',
        () =>
          `allowed=${String(allowed)} from=${this.snapshot.spreadIndex} target=${target} snapshot=${describeSnapshot(this.snapshot)}`,
      );
      return target;
    }, performanceId);
  }

  async previous(performanceId?: string): Promise<ReaderSnapshot> {
    return this.enqueueNavigation(() => {
      const allowed = this.publication?.canNavigate?.('previous') !== false;
      const target = allowed
        ? (this.publication?.getAdjacentSpreadIndex?.(this.snapshot.spreadIndex, 'previous') ??
          this.snapshot.spreadIndex - 1)
        : this.snapshot.spreadIndex;
      readerDiagnostic(
        'runtime.previous',
        () =>
          `allowed=${String(allowed)} from=${this.snapshot.spreadIndex} target=${target} snapshot=${describeSnapshot(this.snapshot)}`,
      );
      return target;
    }, performanceId);
  }

  getCurrentPicture(
    revisionId = this.snapshot.revisionId,
    spreadIndex = this.snapshot.spreadIndex,
    renderId = this.pictureRenderIds.get(pictureSlotKey(revisionId, spreadIndex)),
  ): CompiledReaderPicture | undefined {
    if (renderId === undefined) return undefined;
    // A render identity may be assigned to more than one logical slot when
    // the same sealed picture is reused after a chapter-boundary turn. The
    // cache resolves by render identity, so the caller's current slot does
    // not need to match the slot where the Picture was first compiled.
    const retained = this.pictures.getByRenderId(revisionId, renderId);
    if (!retained) {
      readerDiagnostic(
        'picture.miss',
        () => `revision=${revisionId} spread=${spreadIndex} renderId=${renderId} cacheEntries=${this.pictures.size}`,
      );
      return undefined;
    }
    const frame = this.getCurrentFrame(spreadIndex);
    const frameRenderKey = frame ? pictureRenderKey(frame) : undefined;
    const retainedRenderKey = pictureRenderKey(retained);
    if (frameRenderKey && retainedRenderKey && frameRenderKey !== retainedRenderKey) {
      readerDiagnostic(
        'picture.identity.reject',
        () =>
          `revision=${revisionId} spread=${spreadIndex} renderId=${renderId} frameRenderKey=${frameRenderKey} pictureRenderKey=${retainedRenderKey}`,
      );
      return undefined;
    }
    return retained?.compiled;
  }

  getCurrentFrame(spreadIndex = this.snapshot.spreadIndex): ReaderRenderFrame | undefined {
    return this.publication?.getFrame(spreadIndex);
  }

  getCurrentChapterTitle(): string | undefined {
    return this.publication?.getCurrentChapterTitle?.();
  }

  /** Resolve the registered reader font for Skia-owned chrome text. */
  getUiFont(sizePx: number, weight = 400): SkFont | undefined {
    const fontRegistry = this.fontRegistry;
    if (!fontRegistry || !Number.isFinite(sizePx) || sizePx <= 0) return undefined;
    try {
      return fontRegistry.resolveFont({
        family: this.chromeFontFamily,
        sizePx,
        style: 'normal',
        weight,
      });
    } catch {
      return undefined;
    }
  }

  /**
   * Swaps the face Skia-owned chrome text paints with.
   *
   * Chrome is drawn by this app rather than laid out by Rito, so the change
   * never reaches pagination and deliberately bypasses `updateLayout`, which
   * would re-read the whole book and re-paginate every chapter. Callers redraw
   * when {@link getChromeFontEpoch} changes; the surface resolves its font
   * during render, so a re-render is all that is needed.
   */
  setChromeFontFace(face: ReaderFontFace | undefined): number {
    const family = face?.family ?? LUNAR_READER_FONT_FAMILY;
    const source = face?.source ?? 'builtin';
    if (family === this.chromeFontFamily && source === (this.chromeFontFace?.source ?? 'builtin')) {
      return this.chromeFontEpoch;
    }
    this.chromeFontEpoch += 1;
    // A session that has not opened yet has no registry to register into; the
    // face is picked up by `loadCurrentRequest` when one is created.
    this.applyChromeFontFace(this.fontRegistry, face);
    for (const listener of this.chromeFontListeners) {
      listener();
    }
    return this.chromeFontEpoch;
  }

  getChromeFontEpoch(): number {
    return this.chromeFontEpoch;
  }

  subscribeChromeFont(listener: () => void): () => void {
    this.chromeFontListeners.add(listener);
    return () => {
      this.chromeFontListeners.delete(listener);
    };
  }

  /**
   * Installs a chrome face on the live registry, degrading to the bundled face
   * when it cannot be resolved. Chrome is painted by this app, so a face it
   * cannot draw only costs the reader a font choice — never the session.
   */
  private applyChromeFontFace(fontRegistry: LunarSkiaFontRegistry | undefined, face: ReaderFontFace | undefined): void {
    this.chromeFontFace = face;
    this.chromeFontFamily = face?.family ?? LUNAR_READER_FONT_FAMILY;
    // The bundled face is registered under its stable reader name already, and
    // the registry would have no bytes to register it from anyway.
    if (!face || face.source === 'builtin' || !fontRegistry) {
      return;
    }
    try {
      fontRegistry.registerChromeFontFace(face);
    } catch (error) {
      this.chromeFontFace = undefined;
      this.chromeFontFamily = LUNAR_READER_FONT_FAMILY;
      readerDiagnostic(
        'chrome.font.reject',
        () => `family=${face.family} reason=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getCurrentHitMap(spreadIndex = this.snapshot.spreadIndex) {
    const frame = this.getCurrentFrame(spreadIndex);
    return frame?.hits ? { pageIndex: frame.pageIndices[0] ?? spreadIndex, entries: frame.hits } : undefined;
  }

  getCurrentImageBytes(source: string): Uint8Array | undefined {
    if (this.snapshot.phase !== 'ready') return undefined;
    const frame = this.getCurrentFrame();
    if (!frame?.imageSources.includes(source)) return undefined;
    const bytes = this.imageByteCache.get(source);
    return bytes?.slice();
  }

  getCurrentSemantics(spreadIndex = this.snapshot.spreadIndex) {
    return this.getCurrentFrame(spreadIndex)?.semantics ?? [];
  }

  async readFootnote(
    key: string,
    spreadIndex = this.snapshot.spreadIndex,
  ): Promise<import('../../contracts').ReaderFootnote | undefined> {
    const publication = this.publication;
    if (!publication?.readFootnote || this.snapshot.phase !== 'ready') return undefined;
    const revision = this.snapshot.revisionId;
    const footnote = await publication.readFootnote(key, spreadIndex);
    return revision === this.snapshot.revisionId ? footnote : undefined;
  }

  async resolveTextRangeGeometry(
    request: import('../../contracts').ReaderTextRangeGeometryRequest,
  ): Promise<readonly import('../../contracts').ReaderTextRangeRect[]> {
    const publication = this.publication;
    if (!publication?.resolveTextRangeGeometry || this.snapshot.phase !== 'ready') return [];
    const owner = this.snapshot;
    const rects = await publication.resolveTextRangeGeometry(request);
    const current = this.snapshot;
    return publication === this.publication &&
      current.phase === 'ready' &&
      owner.revisionId === current.revisionId &&
      owner.spreadIndex === current.spreadIndex &&
      owner.renderId === current.renderId
      ? rects
      : [];
  }

  async resolveExactSourceRange(
    request: import('../../contracts').ReaderExactSourceRangeRequest,
  ): Promise<import('../../contracts').ReaderExactSourceRangeResolution> {
    const publication = this.publication;
    if (!publication?.resolveExactSourceRange || this.snapshot.phase !== 'ready') {
      return { status: 'unavailable', selectedText: '', rects: [] };
    }
    const owner = this.snapshot;
    const resolution = await publication.resolveExactSourceRange(request);
    const current = this.snapshot;
    return publication === this.publication &&
      current.phase === 'ready' &&
      owner.revisionId === current.revisionId &&
      owner.spreadIndex === current.spreadIndex &&
      owner.renderId === current.renderId
      ? resolution
      : { status: 'unavailable', selectedText: '', rects: [] };
  }

  async search(
    request: import('../../contracts').ReaderSearchRequest,
  ): Promise<import('../../contracts').ReaderSearchResponse> {
    const publication = this.publication;
    if (!publication?.search || this.snapshot.phase !== 'ready') {
      return { query: request.query, truncated: false, searchedPageCount: 0, results: [] };
    }
    const revision = this.snapshot.revisionId;
    const response = await publication.search(request);
    return revision === this.snapshot.revisionId
      ? response
      : { query: request.query, truncated: false, searchedPageCount: 0, results: [] };
  }

  getBackgroundColor(): string {
    return this.publication?.layout.palette.backgroundColor ?? '#000000';
  }

  async close(): Promise<void> {
    this.beginOperation();
    if (this.snapshot.phase !== 'idle') {
      this.emit({ ...this.snapshot, phase: 'closing' });
    }
    await this.releaseResources();
    this.request = undefined;
    this.emit({
      phase: 'idle',
      revisionId: this.snapshot.revisionId + 1,
      spreadIndex: 0,
    });
  }

  private async loadCurrentRequest(
    request: ReaderOpenRequest,
    data: ArrayBuffer,
    progression: number,
    operation: number,
    phase: 'paginating' | 'reflowing',
  ): Promise<ReaderOpenResult> {
    const fontRegistry = new LunarSkiaFontRegistry();
    const pinnedFonts = await createLunarRitoPinnedFonts({ body: request.fontFaces?.body });
    // Skia has to know the pinned faces under the same aliases Rito paints them
    // with, before any chapter is measured — a face it cannot resolve falls back
    // to the bundled one, and body text would silently render in a font that had
    // no part in deciding the line breaks.
    for (const registration of pinnedFonts.registrations) {
      if (registration.bundled) {
        fontRegistry.loadBuiltinFont(registration.face.bytes, registration.alias);
        continue;
      }
      fontRegistry.registerFontFace(registration.face, registration.alias);
    }
    // Falls back to the face already in force so that a chrome font chosen
    // mid-session survives the reflow that a body font change triggers.
    this.applyChromeFontFace(fontRegistry, request.fontFaces?.chrome ?? this.chromeFontFace);
    const textMeasurer = new LunarSkiaTextMeasurer(fontRegistry);
    this.fontRegistry = fontRegistry;
    this.textMeasurer = textMeasurer;
    this.emit({ ...this.snapshot, phase });

    const openOptions: RitoNativePaginationOpenOptions = {
      data,
      layout: request,
      request,
      revisionId: this.snapshot.revisionId,
      operationId: operation,
      signal: this.abortController?.signal ?? new AbortController().signal,
      fontRegistry,
      textMeasurer,
      imageCache: this.imageByteCache,
      pinnedFonts: pinnedFonts.faces,
    };
    const backendResult = await this.paginationBackend.open(openOptions);
    const publication = backendResult.publication;
    this.assertCurrent(operation);
    this.publication = publication;
    this.paginationComplete = publication.totalSpreads !== undefined;
    this.imageCache ??= new SkiaImageCache({
      getBytes: (source) => publication.getImage(source),
    });

    // When a locator is available, the pagination backend has already opened
    // the artifact at that exact source position. Recomputing a whole-book
    // spread from progression would overwrite the chapter-local slot and can
    // send the reader to an unrelated page after a typography reflow.
    const target = request.restorePosition?.locator ? 0 : progressionToSpread(progression, publication.totalSpreads);
    await this.preparePicture(target, operation);
    this.assertCurrent(operation);
    const snapshot = this.createReadySnapshot(target);
    this.emit(snapshot);
    readerPerformanceMark('reader.firstReadySnapshot', `spread=${target}`);
    this.scheduleBackground(operation);
    return { metadata: publication.metadata, toc: publication.toc, snapshot };
  }

  private async showSpread(spreadIndex: number): Promise<ReaderSnapshot> {
    const publication = this.publication;
    if (!publication || this.snapshot.phase !== 'ready') {
      return this.snapshot;
    }
    const target = Math.max(0, Math.round(Number.isFinite(spreadIndex) ? spreadIndex : 0));
    const operation = this.operation;
    readerDiagnostic(
      'runtime.show.begin',
      () => `requested=${spreadIndex} target=${target} snapshot=${describeSnapshot(this.snapshot)}`,
    );
    try {
      await this.preparePicture(target, operation);
    } catch (error) {
      if (error instanceof RangeError) {
        readerDiagnostic('runtime.show.range', () => `target=${target} error=${describeError(error)}`);
        return this.snapshot;
      }
      readerDiagnostic('runtime.show.error', () => `target=${target} error=${describeError(error)}`);
      throw error;
    }
    this.assertCurrent(operation);
    // Exact seeks and chapter-local turns need a publication handoff even
    // when the whole-book layout finished before this navigation.
    if (publication.getBookPageIndex && publication.getBookPageIndex(target) === undefined) {
      this.paginationComplete = false;
    }
    const snapshot = this.createReadySnapshot(target);
    this.emit(snapshot);
    readerDiagnostic('runtime.show.ready', () => `target=${target} snapshot=${describeSnapshot(snapshot)}`);
    this.scheduleBackground(operation);
    return snapshot;
  }

  private enqueueNavigation(resolveTarget: () => number, performanceId?: string): Promise<ReaderSnapshot> {
    return this.enqueueForeground(() => this.showSpread(resolveTarget()), 'navigate', performanceId);
  }

  private async restorePreparedSource(
    sourcePreparedSpreadIndex: number,
    sourceSnapshotSpreadIndex: number,
    operation: number,
  ): Promise<void> {
    await this.preparePicture(sourcePreparedSpreadIndex, operation);
    this.publication?.rebaseVisibleSpreadIndex?.(sourceSnapshotSpreadIndex);
    await this.preparePicture(sourceSnapshotSpreadIndex, operation);
  }

  private resolveSpreadTarget(requestedSpreadIndex: number): number {
    const requested = Math.round(Number.isFinite(requestedSpreadIndex) ? requestedSpreadIndex : 0);
    const currentBookSpread = this.snapshot.bookSpreadIndex;
    if (currentBookSpread === undefined) {
      return requested;
    }
    // Progress controls use the whole-book number, while the publication
    // keeps a render slot for the currently visible artifact. Translate the
    // requested page by relative distance so adjacent artifact navigation
    // remains the source of truth.
    return this.snapshot.spreadIndex + requested - currentBookSpread;
  }

  private enqueueAsyncNavigation(resolveTarget: () => Promise<number>): Promise<ReaderSnapshot> {
    return this.enqueueForeground(async () => this.showSpread(await resolveTarget()));
  }

  private enqueueForeground<T>(
    action: () => Promise<T>,
    kind = 'navigate',
    workId = readerPerformanceId(kind),
  ): Promise<T> {
    const queuedAt = readerPerformanceStart();
    this.foregroundQueued += 1;
    return this.enqueueAction(async () => {
      readerPerformanceEnd('reader.runtime.queue', queuedAt, { workId, operation: kind });
      this.performanceId = workId;
      const startedAt = readerPerformanceStart();
      let status = 'ok';
      try {
        return await action();
      } catch (error) {
        status = 'error';
        throw error;
      } finally {
        readerPerformanceEnd('reader.runtime.operation', startedAt, {
          workId,
          operation: kind,
          status,
          revision: this.snapshot.revisionId,
          spread: this.snapshot.spreadIndex,
          renderId: this.snapshot.renderId,
        });
        this.performanceId = undefined;
        this.foregroundQueued -= 1;
        if (this.foregroundQueued === 0) this.scheduleBackground(this.operation);
      }
    });
  }

  private enqueueAction<T>(action: () => Promise<T>): Promise<T> {
    const run = this.actionTail.then(action, action);
    this.actionTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async advanceBackground(operation: number): Promise<void> {
    this.backgroundScheduled = false;
    const backend = this.paginationBackend as Partial<ReaderBackgroundPaginationBackend>;
    if (typeof backend.advanceBackground !== 'function') return;
    if (operation !== this.operation || this.abortController?.signal.aborted) return;
    if (this.foregroundQueued > 0 || this.preparedTurn || this.backgroundSuspensions.size > 0) {
      readerDiagnostic('runtime.bg.pause', () => `operation=${operation} foregroundQueued=${this.foregroundQueued}`);
      return;
    }
    const quantumStartedAt = readerPerformanceStart('reader.background.quantum');
    let result: unknown;
    readerDiagnostic('runtime.bg.begin', () => `operation=${operation} snapshot=${describeSnapshot(this.snapshot)}`);
    try {
      result = await backend.advanceBackground();
    } catch (error) {
      readerDiagnostic('runtime.bg.error', () => `operation=${operation} error=${describeError(error)}`);
      if (operation === this.operation && !this.abortController?.signal.aborted && isRetryableBackgroundError(error)) {
        this.scheduleBackground(operation);
        return;
      }
      throw error;
    } finally {
      if (quantumStartedAt !== undefined)
        readerPerformanceActivity('background.quantum', performance.now() - quantumStartedAt);
    }
    readerDiagnostic(
      'runtime.bg.result',
      () =>
        `operation=${operation} result=${describeBackgroundResult(result)} snapshot=${describeSnapshot(this.snapshot)}`,
    );
    if (operation !== this.operation || this.abortController?.signal.aborted) return;
    const totalSpreads = this.publication?.totalSpreads;
    if (
      totalSpreads !== this.snapshot.totalSpreads ||
      this.publication?.getBookPageIndex?.(this.snapshot.spreadIndex) !== this.snapshot.position?.bookPageIndex
    ) {
      this.emit(this.createReadySnapshot(this.snapshot.spreadIndex));
    }
    if (isBackgroundComplete(result)) {
      this.paginationComplete = true;
      readerPerformanceMark(
        'reader.background.complete',
        `totalSpreads=${this.publication?.totalSpreads ?? 'unknown'}`,
      );
      if (this.snapshot.paginationComplete !== true) {
        this.emit(this.createReadySnapshot(this.snapshot.spreadIndex));
      }
      return;
    }
    if (this.foregroundQueued === 0) this.scheduleBackground(operation);
  }

  private scheduleBackground(operation: number): void {
    if (
      !this.publication ||
      this.snapshot.phase !== 'ready' ||
      this.backgroundScheduled ||
      this.paginationComplete ||
      this.foregroundQueued > 0 ||
      this.preparedTurn ||
      this.backgroundSuspensions.size > 0 ||
      operation !== this.operation ||
      this.abortController?.signal.aborted
    ) {
      return;
    }
    this.backgroundScheduled = true;
    readerDiagnostic('runtime.bg.schedule', () => `operation=${operation}`);
    setTimeout(() => {
      void this.advanceBackground(operation).catch(() => undefined);
    }, 32);
  }

  private async preparePicture(spreadIndex: number, operation: number): Promise<void> {
    const publication = this.publication;
    const imageCache = this.imageCache;
    const textMeasurer = this.textMeasurer;
    if (!publication || !imageCache || !textMeasurer) {
      throw new Error('The reader resources are unavailable.');
    }
    const revisionId = this.snapshot.revisionId;
    const slotKey = pictureSlotKey(revisionId, spreadIndex);
    const activeRenderId = this.pictureRenderIds.get(slotKey);
    const detail = { workId: this.performanceId, revision: revisionId, spread: spreadIndex };
    const frameStartedAt = readerPerformanceStart();
    let frame: ReaderRenderFrame | undefined;
    try {
      frame = await this.paginationBackend.getFrame(this.snapshot.revisionId, spreadIndex);
    } finally {
      readerPerformanceEnd('reader.frame.resolve', frameStartedAt, detail);
    }
    frame ??= publication.getFrame(spreadIndex);
    if (!frame) {
      throw new RangeError(`Spread ${spreadIndex} is outside the publication.`);
    }
    const activePicture =
      activeRenderId === undefined
        ? undefined
        : this.pictures.get({ revisionId, spreadIndex, renderId: activeRenderId });
    if (activePicture) {
      if (pictureRenderKey(activePicture) === pictureRenderKey(frame)) {
        readerPerformanceMark('reader.picture.cache', { ...detail, hit: 'slot' });
        return;
      }
      this.invalidatePicture(spreadIndex);
    }
    const renderKey = frame.renderKey ?? frame.sourceKey;
    if (renderKey) {
      const cachedRenderId = this.pictureRenderIdsByRenderKey.get(renderKey);
      const cachedPicture =
        cachedRenderId === undefined ? undefined : this.pictures.getByRenderId(revisionId, cachedRenderId);
      if (cachedPicture && cachedRenderId !== undefined) {
        this.pictureRenderIds.set(slotKey, cachedRenderId);
        readerPerformanceMark('reader.picture.cache', { ...detail, hit: 'render' });
        readerDiagnostic(
          'picture.cache.hit',
          () => `spread=${spreadIndex} renderId=${cachedRenderId} renderKey=${renderKey}`,
        );
        return;
      }
      this.pictureRenderIdsByRenderKey.delete(renderKey);
    }
    readerDiagnostic(
      'picture.compile.begin',
      () => `spread=${spreadIndex} renderKey=${renderKey ?? 'none'} sourceKey=${frame.sourceKey ?? 'none'}`,
    );
    readerPerformanceMark('reader.picture.cache', { ...detail, hit: 'miss' });
    const imagesStartedAt = readerPerformanceStart();
    const imageLease = await imageCache.acquire(frame.imageSources).finally(() => {
      readerPerformanceEnd('reader.images.acquire', imagesStartedAt, { ...detail, count: frame!.imageSources.length });
    });
    try {
      this.assertCurrent(operation);
    } catch (error) {
      this.deferSkiaCleanup(() => imageLease.release());
      throw error;
    }
    const pictureStartedAt = readerPerformanceStart('reader.picture.compile');
    let picture: CompiledReaderPicture | undefined;
    try {
      picture = this.pictureCompiler.compile(frame.displayList, {
        // ReaderSurface positions Pictures in logical pixels; the Rito renderer
        // converts its device-pixel primitives to this Picture coordinate space.
        pixelRatio: 1,
        images: imageCache,
        paragraphs: textMeasurer.paragraphs,
        colorOverride: {
          backgroundColor: publication.layout.palette.backgroundColor,
          foregroundColor: publication.layout.palette.foregroundColor,
        },
      });
    } catch (error) {
      this.deferSkiaCleanup(() => imageLease.release());
      throw error;
    } finally {
      readerPerformanceEnd('reader.picture.compile', pictureStartedAt, {
        ...detail,
        commands: frame.displayList.resolvedPrimitives.commands.length,
        ...picture?.textMetrics,
      });
    }
    this.renderId += 1;
    const renderId = this.renderId;
    this.pictures.set(
      { revisionId, spreadIndex, renderId },
      { renderId, compiled: picture, imageLease, sourceKey: frame.sourceKey, renderKey: frame.renderKey },
    );
    if (renderKey) this.pictureRenderIdsByRenderKey.set(renderKey, renderId);
    this.pictureRenderIds.set(slotKey, renderId);
    readerDiagnostic(
      'picture.compile.done',
      () => `spread=${spreadIndex} renderId=${renderId} renderKey=${renderKey ?? 'none'}`,
    );
  }

  private invalidatePicture(spreadIndex: number): void {
    const revisionId = this.snapshot.revisionId;
    const slotKey = pictureSlotKey(revisionId, spreadIndex);
    const renderId = this.pictureRenderIds.get(slotKey);
    if (renderId === undefined) return;
    // Touch the old entry before publishing its replacement so an in-flight
    // React Skia tree can keep resolving the previous render ID while the new
    // Picture is compiled. Cleanup remains deferred by the cache disposer.
    this.pictures.get({ revisionId, spreadIndex, renderId });
    this.pictureRenderIds.delete(slotKey);
  }

  /**
   * Skia may redraw a committed React tree after the runtime has emitted a
   * replacement snapshot. Delay native resource destruction until two frames
   * have completed so an evicted, non-current Picture is no longer referenced
   * by a committed Canvas tree.
   */
  private deferSkiaCleanup(cleanup: () => void): void {
    const run = () => {
      try {
        cleanup();
      } catch {
        // Resource cleanup is best effort after the owning frame is gone.
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(run));
      return;
    }
    setTimeout(() => setTimeout(run, 0), 0);
  }

  private createReadySnapshot(spreadIndex: number): ReaderSnapshot {
    const publication = this.publication;
    if (!publication) {
      throw new Error('The publication is unavailable.');
    }
    const frame = publication.getFrame(spreadIndex);
    const locator = publication.getCurrentLocator?.(spreadIndex);
    const bookPageIndex = publication.getBookPageIndex?.(spreadIndex);
    const bookSpreadIndex =
      bookPageIndex === undefined
        ? undefined
        : publication.layout.spreadMode === 'double'
          ? Math.floor(bookPageIndex / 2)
          : bookPageIndex;
    const position: ReaderPosition = {
      locator,
      progression:
        publication.totalSpreads === undefined || publication.totalSpreads <= 1 || bookSpreadIndex === undefined
          ? 0
          : bookSpreadIndex / (publication.totalSpreads - 1),
      pageIndex: frame?.pageIndices[0] ?? spreadIndex,
      spreadIndex,
      bookPageIndex,
      bookSpreadIndex,
      timestamp: Date.now(),
    };
    return {
      phase: 'ready',
      bookId: this.request?.bookId,
      revisionId: this.snapshot.revisionId,
      spreadIndex,
      renderId: this.pictureRenderIds.get(pictureSlotKey(this.snapshot.revisionId, spreadIndex)),
      bookSpreadIndex,
      chapterTitle: publication.getCurrentChapterTitle?.(),
      totalSpreads: bookSpreadIndex === undefined ? undefined : publication.totalSpreads,
      paginationComplete: this.paginationComplete,
      position,
    };
  }

  private beginOperation(): number {
    if (this.operation > 0) {
      void this.paginationBackend.cancel(this.operation, this.snapshot.revisionId);
    }
    this.abortController?.abort();
    this.abortController = new AbortController();
    this.operation += 1;
    return this.operation;
  }

  private assertCurrent(operation: number): void {
    if (operation !== this.operation || this.abortController?.signal.aborted) {
      const error = new Error('The reader operation was superseded.');
      error.name = 'AbortError';
      throw error;
    }
  }

  private async fail(operation: number, error: unknown): Promise<void> {
    if (operation !== this.operation || (error instanceof Error && error.name === 'AbortError')) {
      return;
    }
    const diagnostic =
      error instanceof Error ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}` : error;
    console.error('[LunarReaderRuntime] Reader operation failed.', diagnostic);
    await this.releaseResources();
    this.emit({
      ...this.snapshot,
      phase: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  private async releaseResources(): Promise<void> {
    this.pictures.clear();
    this.pictureRenderIds.clear();
    this.pictureRenderIdsByRenderKey.clear();
    const imageCache = this.imageCache;
    if (imageCache) this.deferSkiaCleanup(() => imageCache.clear());
    this.imageCache = undefined;
    this.pictureCompiler.clearCache();
    this.textMeasurer?.dispose();
    this.textMeasurer = undefined;
    this.publication = undefined;
    this.preparedTurn = undefined;
    this.paginationComplete = false;
    this.backgroundScheduled = false;
    // Cached SkPictures may still reference these typefaces until the two
    // deferred frames drain, and a registry now holds decoded copies of the
    // imported face — tens of megabytes for a CJK font — so it has to be
    // released through the same deferral rather than dropped on the floor.
    const fontRegistry = this.fontRegistry;
    if (fontRegistry) this.deferSkiaCleanup(() => fontRegistry.dispose());
    this.fontRegistry = undefined;
    await this.paginationBackend.close().catch(() => undefined);
    this.imageByteCache.clear();
  }

  private emit(snapshot: ReaderSnapshot): void {
    readerPerformanceActivity('runtime.snapshot', 0, {
      phase: snapshot.phase,
      revision: snapshot.revisionId,
      spread: snapshot.spreadIndex,
    });
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function describeSnapshot(snapshot: ReaderSnapshot): string {
  return `revision=${snapshot.revisionId} spread=${snapshot.spreadIndex} renderId=${snapshot.renderId ?? 'none'} bookSpread=${snapshot.bookSpreadIndex ?? 'none'} chapter=${snapshot.chapterTitle ?? 'none'} total=${snapshot.totalSpreads ?? 'none'} complete=${String(snapshot.paginationComplete)}`;
}

function describeBackgroundResult(result: unknown): string {
  if (typeof result !== 'object' || result === null) return String(result);
  const value = result as {
    readonly state?: unknown;
    readonly movesVisibleContent?: unknown;
    readonly artifact?: {
      readonly artifactId?: bigint;
      readonly revisionId?: bigint;
      readonly locator?: { readonly href?: string };
      readonly localSpreadIndex?: number;
    };
  };
  const artifact = value.artifact;
  return `state=${String(value.state ?? 'none')} moves=${String(value.movesVisibleContent ?? 'none')} artifact=${artifact ? `${artifact.artifactId?.toString() ?? 'none'}@${artifact.revisionId?.toString() ?? 'none'}:${artifact.locator?.href ?? 'none'}:${artifact.localSpreadIndex ?? 'none'}` : 'none'}`;
}

function describeError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const value = error as { readonly status?: unknown; readonly message?: unknown };
  return `status=${String(value.status ?? 'none')} message=${String(value.message ?? error)}`;
}

function pictureRenderKey(
  value: Pick<RetainedReaderPicture, 'renderKey' | 'sourceKey'> | Pick<ReaderRenderFrame, 'renderKey' | 'sourceKey'>,
): string | undefined {
  return value.renderKey ?? value.sourceKey;
}

function isRetryableBackgroundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  const status = (error as { readonly status?: unknown }).status;
  return status === 5 || status === 8;
}

function isBackgroundComplete(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !('state' in value)) {
    return false;
  }
  const state = (value as { state?: unknown }).state;
  return state === 'complete' || state === 'terminal';
}

function progressionToSpread(progression: number, totalSpreads?: number): number {
  if (totalSpreads === undefined || totalSpreads <= 1) {
    return 0;
  }
  return clampSpread(Math.round(clampProgression(progression) * (totalSpreads - 1)), totalSpreads);
}

function clampProgression(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function clampSpread(value: number, totalSpreads: number): number {
  const upper = Math.max(0, totalSpreads - 1);
  return Math.min(upper, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
}

function pictureSlotKey(revisionId: number, spreadIndex: number): string {
  return `${revisionId}:${spreadIndex}`;
}
