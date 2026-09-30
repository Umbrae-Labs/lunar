import type { RitoPublication, RitoTocEntry, RitoReaderSession } from '@umbrae-labs/rito-rn';
import type {
  LoadedReaderPublication,
  ReaderFontRegistry,
  ReaderImageDecoder,
  ReaderLayoutRequest,
  ReaderLocator,
  ReaderOpenRequest,
  ReaderPreparedAdjacent,
  ReaderRenderFrame,
} from '../../contracts';
import { toReaderDisplayList } from '../../rito';
import { discoverReaderInitialSpineHref } from '../../rito/epub-inspector';
import type {
  RitoArtifact,
  RitoLayoutRequest,
  RitoNativePinnedFontFace,
  RitoNativeReaderModule,
} from '../../rito/rito-native';
import { toRitoSavedLocator } from '../../rito/saved-locator';
import { LUNAR_READER_FONT_FAMILY } from '../../typography';
import { ReaderImageByteCache } from '../cache/reader-image-cache';
import { ReaderOperationQueue } from '../cache/reader-operation-queue';
import {
  readerDiagnostic,
  readerPerformanceActivity,
  readerPerformanceAsync,
  readerPerformanceEnd,
  readerPerformanceMark,
  readerPerformanceStart,
} from '../core/performance';
import type {
  ReaderBackgroundPaginationBackend,
  ReaderPaginationBackendOpenOptions,
  ReaderPaginationBackendResult,
} from './pagination-backend';

export interface RitoNativePaginationBackendOptions {
  readonly initialHref?: string;
  readonly native?: RitoNativeReaderModule;
}

/**
 * The Rito open additionally carries the pinned faces, because the runtime has
 * to resolve them itself: every pinned face is painted under a Rito alias, and
 * Skia only agrees with layout if it registered the same bytes under the same
 * alias before the chapter is measured.
 */
export interface RitoNativePaginationOpenOptions extends ReaderPaginationBackendOpenOptions {
  readonly pinnedFonts: readonly RitoNativePinnedFontFace[];
}

interface PublicationSlot {
  readonly artifactId: bigint;
  readonly frame?: ReaderRenderFrame;
}

interface PreparedAdjacentState extends ReaderPreparedAdjacent {
  readonly sourceSnapshotSpreadIndex: number;
  readonly sourceArtifactId: bigint;
  readonly targetArtifactId: bigint;
  readonly previousTargetSlot?: PublicationSlot;
}

// The engine enforces a hard live-artifact cap (6). Steady state keeps the
// visible artifact, the last turn source, one retained boundary and its
// replaced identity live (1 + 1 + 1 + 1), leaving two slots for a neighbor
// preview and the transient foreground/background candidate.
const RETAINED_BOUNDARY_ARTIFACT_CAP = 1;
const RETAINED_BOUNDARY_KEEP_ALIVE_CAP = 1;
const RETAINED_SLOT_RADIUS = 4;

/**
 * Rito 2.0.0 pagination backend. It keeps the native artifact as the source of
 * truth and materializes only the resources referenced by the active artifact.
 * The initial EPUB spine href is resolved from the package document because
 * Rito's request contract intentionally requires an explicit locator.
 */
export class RitoNativePaginationBackend implements ReaderBackgroundPaginationBackend {
  private session?: RitoReaderSession;
  private publication?: RitoNativePublication;
  private imageCache?: ReaderImageByteCache;
  private ownsImageCache = false;
  private operationId?: number;
  private revisionId?: number;

  constructor(private readonly config: RitoNativePaginationBackendOptions = {}) {}

  async open(options: RitoNativePaginationOpenOptions): Promise<ReaderPaginationBackendResult> {
    const openStartedAt = readerPerformanceStart('reader.backend.open');
    await this.close();
    const initialHref = this.config.initialHref ?? discoverReaderInitialSpineHref(new Uint8Array(options.data));
    readerPerformanceMark('reader.backend.initialHref', initialHref);
    const request = createArtifactRequest(
      options.request,
      options.layout,
      options.revisionId,
      options.operationId,
      initialHref,
    );
    const { RitoReaderSession } = await import('@umbrae-labs/rito-rn');
    const opened = await RitoReaderSession.open(new Uint8Array(options.data), request, options.pinnedFonts, {
      native: this.config.native,
    });
    readerPerformanceMark('reader.backend.firstArtifact', `artifactId=${opened.artifact.artifactId.toString()}`);
    const publicationMetadata = await opened.session.readPublication();
    const imageCache = options.imageCache ?? new ReaderImageByteCache();
    this.imageCache = imageCache;
    this.ownsImageCache = options.imageCache === undefined;
    const publication = new RitoNativePublication(
      opened.session,
      opened.artifact,
      publicationMetadata,
      options.layout,
      request,
      options.fontRegistry,
      options.imageDecoder,
      imageCache,
    );
    await publication.prepare(opened.artifact);
    this.session = opened.session;
    this.publication = publication;
    this.operationId = options.operationId;
    this.revisionId = options.revisionId;
    readerPerformanceEnd('reader.backend.open', openStartedAt);
    return {
      publication,
      operationId: options.operationId,
      revisionId: options.revisionId,
    };
  }

  async getFrame(revisionId: number, spreadIndex: number): Promise<ReaderRenderFrame | undefined> {
    if (revisionId !== this.revisionId || !this.publication) return undefined;
    await this.publication.ensureFrame(spreadIndex);
    return this.publication.getFrame(spreadIndex);
  }

  async advanceBackground(): Promise<unknown> {
    if (!this.publication) throw new Error('Rito native publication is not open.');
    return this.publication.advanceBackground();
  }

  async cancel(operationId: number, revisionId: number): Promise<void> {
    if (this.operationId === operationId && this.revisionId === revisionId) await this.close();
  }

  async close(): Promise<void> {
    const publication = this.publication;
    this.publication = undefined;
    this.operationId = undefined;
    this.revisionId = undefined;
    this.session = undefined;
    try {
      await publication?.close();
    } finally {
      if (this.ownsImageCache) this.imageCache?.clear();
      this.imageCache = undefined;
      this.ownsImageCache = false;
    }
  }
}

class RitoNativePublication implements LoadedReaderPublication {
  private readonly slots = new Map<number, PublicationSlot>();
  private readonly retainedBoundaryArtifacts = new Map<string, bigint>();
  /**
   * Boundary artifacts that lost their retained-map slot but are kept alive
   * for a few more navigations. The engine's exact-locator cache matches a
   * backward chapter seek on the href+progression locator that only the
   * seek-resolved artifact carries; re-published artifacts carry a
   * source-point locator instead, so dropping the replaced identity
   * immediately forces the whole previous chapter to be paginated again on
   * the next crossing.
   */
  private readonly retainedBoundaryKeepAlive: bigint[] = [];
  /**
   * Artifact the most recent foreground turn navigated away from. It stays
   * live (and its chapter revision therefore reusable by the engine's exact
   * locator cache) until the next navigation replaces it.
   */
  private lastTurnSourceId?: bigint;
  private preparedAdjacentId = 0;
  private preparedAdjacent?: PreparedAdjacentState;
  private closed = false;
  private visibleIndex = 0;
  private totalSpreadsValue?: number;
  private readonly metadataValue: LoadedReaderPublication['metadata'];
  private readonly tocValue: LoadedReaderPublication['toc'];
  private readonly tocLabelsByHref: ReadonlyMap<string, string>;
  private readonly spine: RitoPublication['spine'];
  private readonly operationQueue = new ReaderOperationQueue();
  // Registration is session-scoped. Check before readResource: otherwise each
  // page transfers the same (potentially multi-megabyte) font over JSI again.
  private readonly loadedFonts = new Set<string>();

  private readonly spreadMode: 'single' | 'double';
  private readonly layoutValue: LoadedReaderPublication['layout'];

  constructor(
    private readonly session: RitoReaderSession,
    first: RitoArtifact,
    publication: RitoPublication,
    layout: ReaderLayoutRequest,
    private readonly artifactRequest: import('../../rito/rito-native').RitoArtifactRequest,
    private readonly fonts?: ReaderFontRegistry,
    private readonly imageDecoder?: ReaderImageDecoder,
    private readonly imageCache?: ReaderImageByteCache,
  ) {
    this.spreadMode = layout.typography.spreadMode;
    this.layoutValue = toReaderLayoutParameters(layout);
    this.metadataValue = publication.metadata;
    this.tocValue = publication.toc.map(toReaderToc);
    this.tocLabelsByHref = createTocLabelIndex(this.tocValue);
    this.spine = publication.spine;
    this.slots.set(0, { artifactId: first.artifactId });
    this.totalSpreadsValue =
      first.bookPageCount !== undefined ? spreadCountFromBookPages(first.bookPageCount, this.spreadMode) : undefined;
  }

  async prepare(
    artifact: RitoArtifact,
    spreadIndex = this.indexForArtifact(artifact),
    replace = false,
    background = false,
  ): Promise<void> {
    const sourceKey = artifactSourceKey(artifact);
    const existing = this.slots.get(spreadIndex);
    if (existing?.frame && !replace && existing.frame.sourceKey === sourceKey) return;
    for (const font of artifact.fonts) {
      if (!this.fonts) break;
      const key = JSON.stringify([
        font.href,
        font.family,
        font.weight,
        font.style,
        font.shapeFingerprint,
        String(font.byteLength),
      ]);
      if (this.loadedFonts.has(key)) continue;
      const resource = await readerPerformanceAsync(
        'reader.font.read',
        () => this.session.readResource(artifact.artifactId, 1, font.href),
        () => ({
          artifact: String(artifact.artifactId),
          bytes: Number(font.byteLength),
        }),
      );
      await readerPerformanceAsync(
        'reader.font.register',
        () =>
          this.fonts!.loadFont({
            family: font.family,
            src: font.href,
            bytes: resource.bytes,
            weight: String(font.weight),
            style: font.style,
            fingerprint: font.shapeFingerprint,
            byteLength: Number(font.byteLength),
          }),
        { bytes: resource.bytes.byteLength },
      );
      this.loadedFonts.add(key);
    }
    const imageResources = artifact.resources.filter((resource) => resource.kind === 'image');
    const imageSources = imageResources.map((resource) => resource.href);
    for (const resource of imageResources) {
      if (this.imageCache?.get(resource.href)) continue;
      const image = await readerPerformanceAsync(
        'reader.image.read',
        () => this.session.readResource(artifact.artifactId, 0, resource.href),
        () => ({ artifact: String(artifact.artifactId) }),
      );
      this.imageCache?.set(resource.href, image.bytes, imageSources);
    }
    const convertStartedAt = readerPerformanceStart();
    const display = toReaderDisplayList(artifact.displayList.displayList, artifact.width, artifact.height);
    const pages = artifact.pages.filter((page) => artifact.localPageIndexes.includes(page.pageIndex));
    if (pages.length === 0 || artifact.localPageIndexes.length === 0) {
      readerDiagnostic('frame.empty', () => `artifact=${describeArtifact(artifact)} matchedPages=${pages.length}`);
      throw new RangeError(`Rito artifact ${artifact.artifactId.toString()} contains no renderable pages.`);
    }
    const frame: ReaderRenderFrame = {
      spreadIndex,
      manifestHref: artifact.locator.href,
      sourceKey,
      renderKey: artifactRenderKey(artifact, this.imageCache),
      pageIndices: artifact.localPageIndexes,
      width: artifact.width,
      height: artifact.height,
      imageSources: [...new Set(imageSources)],
      displayList: display,
      hits: pages.flatMap(toReaderHitEntries),
      semantics: pages.flatMap((page) => page.semantics.map(toReaderSemanticNode)),
      text: pages.map((page) => page.text).join(''),
    };
    this.slots.set(spreadIndex, { artifactId: artifact.artifactId, frame });
    if (background) {
      if (convertStartedAt !== undefined)
        readerPerformanceActivity('background.frame.convert', performance.now() - convertStartedAt);
    } else {
      readerPerformanceEnd('reader.frame.convert', convertStartedAt, () => ({
        artifact: String(artifact.artifactId),
        spread: spreadIndex,
        commands: display.resolvedPrimitives.commands.length,
      }));
    }
  }

  getFrame(spreadIndex: number): ReaderRenderFrame | undefined {
    const slot = this.slots.get(spreadIndex);
    const frame = slot?.frame;
    if (!frame) return undefined;
    const artifact = slot?.artifactId === undefined ? undefined : this.session.getArtifact(slot.artifactId);
    const sourceMismatch =
      artifact !== undefined && frame.sourceKey !== undefined && frame.sourceKey !== artifactSourceKey(artifact);
    if (!artifact || frame.spreadIndex !== spreadIndex || frame.pageIndices.length === 0 || sourceMismatch) {
      readerDiagnostic(
        'frame.reject',
        () =>
          `requestedSpread=${spreadIndex} frameSpread=${frame.spreadIndex} pageIndexes=${frame.pageIndices.length} frameSource=${frame.sourceKey ?? 'none'} artifactSource=${artifact ? artifactSourceKey(artifact) : 'missing'}`,
      );
      return undefined;
    }
    return frame;
  }

  async ensureFrame(spreadIndex: number): Promise<void> {
    return this.operationQueue.enqueue(async () => {
      await this.ensureFrameQueued(spreadIndex);
    });
  }

  private async ensureFrameQueued(spreadIndex: number): Promise<void> {
    readerDiagnostic(
      'nav.ensure.begin',
      () => `target=${spreadIndex} visibleIndex=${this.visibleIndex} visible=${describeArtifact(this.currentArtifact)}`,
    );
    if (this.preparedAdjacent?.targetSpreadIndex === spreadIndex) {
      const slot = this.slots.get(spreadIndex);
      const artifact = slot ? this.session.getArtifact(slot.artifactId) : undefined;
      if (
        artifact &&
        slot?.artifactId === this.preparedAdjacent.targetArtifactId &&
        slot.frame?.sourceKey === artifactSourceKey(artifact)
      ) {
        readerDiagnostic(
          'turn.backend.prepare.hit',
          () => `candidate=${this.preparedAdjacent?.id} spread=${spreadIndex} artifact=${slot.artifactId.toString()}`,
        );
        return;
      }
    }
    if (spreadIndex === this.visibleIndex) {
      const current = this.currentArtifact;
      const slot = this.slots.get(spreadIndex);
      if (
        current &&
        slot?.artifactId === current.artifactId &&
        slot.frame?.sourceKey === artifactSourceKey(current) &&
        slot.frame.pageIndices.length > 0
      ) {
        readerDiagnostic('nav.ensure.current.hit', () => `spread=${spreadIndex} artifact=${describeArtifact(current)}`);
        return;
      }
      if (current) {
        readerDiagnostic(
          'nav.ensure.current.prepare',
          () =>
            `spread=${spreadIndex} artifact=${describeArtifact(current)} slotArtifact=${slot?.artifactId.toString() ?? 'none'}`,
        );
        await this.prepare(current, spreadIndex);
      }
      return;
    }
    const distance = Math.abs(spreadIndex - this.visibleIndex);
    if (distance === 0 || distance > 4096) return;
    const direction = spreadIndex > this.visibleIndex ? 'next' : 'previous';
    for (let step = 0; step < distance; step += 1) {
      const currentId = this.session.currentVisibleArtifactId;
      const current = currentId === undefined ? undefined : this.session.getArtifact(currentId);
      if (!current || currentId === undefined) return;
      readerDiagnostic(
        'nav.turn.request',
        () =>
          `step=${step + 1}/${distance} direction=${direction} visibleIndex=${this.visibleIndex} artifact=${describeArtifact(current)}`,
      );
      let artifact: RitoArtifact;
      try {
        // Reference contract (rito_flutter/browser reader-v1): requestAdjacent
        // returns an UNADOPTED candidate. Resources must be prepared and only
        // then the candidate adopted, so a preparation failure can never leave
        // the session visible ahead of the published snapshot — that drift is
        // what made repeated presses skip spreads and land chapters away.
        artifact = await readerPerformanceAsync(
          'reader.backend.adjacent',
          () =>
            this.session.requestAdjacent({
              sessionId: current.sessionId,
              requestId: this.session.nextRequestId,
              fromArtifactId: current.artifactId,
              direction,
            }),
          () => ({ fromArtifact: String(current.artifactId), direction }),
        );
      } catch (error) {
        readerDiagnostic(
          'nav.turn.error',
          () =>
            `direction=${direction} visibleIndex=${this.visibleIndex} artifact=${describeArtifact(current)} error=${describeError(error)}`,
        );
        if (this.closed || String(error).includes('session') || String(error).includes('disposed')) {
          return;
        }
        throw error;
      }
      const nextIndex = this.visibleIndex + (direction === 'next' ? 1 : -1);
      try {
        await this.prepare(artifact, nextIndex);
      } catch (error) {
        // The candidate was never adopted, so the visible artifact is
        // unchanged. Release it and let the navigation fail cleanly instead
        // of leaving a half-committed turn behind.
        await this.session.releaseArtifact(artifact.artifactId).catch(() => undefined);
        readerDiagnostic(
          'nav.turn.error',
          () => `direction=${direction} prepareFailed=${describeArtifact(artifact)} error=${describeError(error)}`,
        );
        throw error;
      }
      await this.session.adoptForeground({
        sessionId: current.sessionId,
        expectedVisibleArtifactId: current.artifactId,
        candidateArtifactId: artifact.artifactId,
      });
      this.assignArtifact(nextIndex, artifact);
      this.visibleIndex = nextIndex;
      readerDiagnostic(
        'nav.turn.commit',
        () => `direction=${direction} spread=${nextIndex} artifact=${describeArtifact(artifact)}`,
      );
      this.totalSpreadsValue =
        artifact.bookPageCount !== undefined
          ? spreadCountFromBookPages(artifact.bookPageCount, this.spreadMode)
          : this.totalSpreadsValue;
      // Keep the turn source live (reference: release only after the page-turn
      // no longer paints it). The engine's exact-locator cache can then reuse
      // the already paginated chapter revision when the reader turns back
      // across the boundary instead of re-paginating the whole chapter.
      // Release the source of the previous navigation instead.
      if (this.lastTurnSourceId !== undefined && this.lastTurnSourceId !== current.artifactId) {
        const staleSource = this.session.getArtifact(this.lastTurnSourceId);
        if (staleSource) await this.releaseAfterNavigation(staleSource);
      }
      this.lastTurnSourceId = current.artifactId;
      this.pruneSlots();
    }
  }
  getImage(source: string): Uint8Array | undefined {
    return this.imageCache?.get(source);
  }
  get metadata() {
    return this.metadataValue;
  }
  get toc() {
    return this.tocValue;
  }
  get layout() {
    return this.layoutValue;
  }
  getCurrentChapterTitle(): string | undefined {
    const artifact = this.currentArtifact;
    if (!artifact) return undefined;
    const locatorHref = artifact.locator.anchorId
      ? `${artifact.locator.href}#${artifact.locator.anchorId}`
      : artifact.locator.href;
    return this.tocLabelsByHref.get(locatorHref) ?? this.tocLabelsByHref.get(artifact.locator.href);
  }
  getBookPageIndex(spreadIndex: number): number | undefined {
    return this.artifactForSpread(spreadIndex)?.bookPageIndex;
  }
  getCurrentLocator(spreadIndex: number): import('../../contracts').ReaderLocator | undefined {
    const artifact = this.artifactForSpread(spreadIndex);
    return artifact ? toReaderLocator(artifact.locator, this.spine) : undefined;
  }
  canNavigate(direction: 'next' | 'previous'): boolean {
    const artifact = this.currentArtifact;
    const availability = artifact?.navigation[direction];
    const allowed = availability !== 'terminal';
    readerDiagnostic(
      'nav.availability',
      () =>
        `direction=${direction} allowed=${String(allowed)} availability=${availability ?? 'none'} visibleIndex=${this.visibleIndex} artifact=${describeArtifact(artifact)}`,
    );
    return allowed;
  }
  getAdjacentSpreadIndex(currentSpreadIndex: number, direction: 'next' | 'previous'): number {
    if (this.visibleIndex !== currentSpreadIndex) {
      // Defensive: the backend drifted from the published snapshot (a failed
      // turn or an interrupted multi-step jump). Navigate relative to the
      // snapshot so one press always means exactly one spread; the turn loop
      // re-walks the backend back to the requested index.
      readerDiagnostic(
        'slot.drift',
        () => `direction=${direction} visibleIndex=${this.visibleIndex} snapshot=${currentSpreadIndex}`,
      );
      return Math.max(0, currentSpreadIndex + (direction === 'next' ? 1 : -1));
    }
    if (direction === 'previous' && this.visibleIndex <= 0) {
      const delta = 1 - this.visibleIndex;
      this.rebaseSlots(delta);
      readerDiagnostic(
        'slot.rebase',
        () =>
          `direction=${direction} delta=${delta} requestedCurrent=${currentSpreadIndex} visibleIndex=${this.visibleIndex}`,
      );
    }
    return this.visibleIndex + (direction === 'next' ? 1 : -1);
  }
  async prepareAdjacent(
    currentSpreadIndex: number,
    direction: 'next' | 'previous',
  ): Promise<ReaderPreparedAdjacent | undefined> {
    return this.operationQueue.enqueue(async () => {
      const existing = this.preparedAdjacent;
      if (existing && existing.direction === direction && existing.sourceSpreadIndex === this.visibleIndex) {
        return existing;
      }
      if (existing || this.visibleIndex !== currentSpreadIndex) return undefined;
      const sourceArtifact = this.currentArtifact;
      if (!sourceArtifact || !this.canNavigate(direction)) return undefined;
      const targetSpreadIndex = this.getAdjacentSpreadIndex(currentSpreadIndex, direction);
      const delta = direction === 'next' ? 1 : -1;
      const sourceSpreadIndex = targetSpreadIndex - delta;
      const previousTargetSlot = this.slots.get(targetSpreadIndex);
      let candidate: RitoArtifact | undefined;
      try {
        candidate = await readerPerformanceAsync(
          'reader.backend.adjacent',
          () =>
            this.session.requestAdjacent({
              sessionId: sourceArtifact.sessionId,
              requestId: this.session.nextRequestId,
              fromArtifactId: sourceArtifact.artifactId,
              direction,
            }),
          () => ({
            fromArtifact: String(sourceArtifact.artifactId),
            direction,
          }),
        );
        await this.prepare(candidate, targetSpreadIndex);
        const prepared: PreparedAdjacentState = {
          id: ++this.preparedAdjacentId,
          direction,
          sourceSnapshotSpreadIndex: currentSpreadIndex,
          sourceSpreadIndex,
          targetSpreadIndex,
          sourceArtifactId: sourceArtifact.artifactId,
          targetArtifactId: candidate.artifactId,
          previousTargetSlot,
        };
        this.preparedAdjacent = prepared;
        readerDiagnostic(
          'turn.backend.prepare.ready',
          () =>
            `candidate=${prepared.id} direction=${direction} sourceSpread=${sourceSpreadIndex} targetSpread=${targetSpreadIndex} source=${sourceArtifact.artifactId.toString()} target=${candidate?.artifactId.toString()}`,
        );
        return prepared;
      } catch (error) {
        if (candidate) await this.session.releaseArtifact(candidate.artifactId).catch(() => undefined);
        if (sourceSpreadIndex !== currentSpreadIndex) this.rebaseVisibleSpreadIndex(currentSpreadIndex);
        readerDiagnostic('turn.backend.prepare.error', () => `direction=${direction} error=${describeError(error)}`);
        if (this.closed || String(error).includes('session') || String(error).includes('disposed')) {
          return undefined;
        }
        throw error;
      }
    });
  }
  async commitPreparedAdjacent(prepared: ReaderPreparedAdjacent): Promise<void> {
    await this.operationQueue.enqueue(async () => {
      const active = this.preparedAdjacent;
      if (!active || active.id !== prepared.id) {
        throw new Error('Prepared Rito turn is stale.');
      }
      const source = this.session.getArtifact(active.sourceArtifactId);
      const target = this.session.getArtifact(active.targetArtifactId);
      if (!source || !target) {
        const targetSlot = this.slots.get(active.targetSpreadIndex);
        if (targetSlot?.artifactId === active.targetArtifactId) {
          if (active.previousTargetSlot) {
            this.slots.set(active.targetSpreadIndex, active.previousTargetSlot);
          } else {
            this.slots.delete(active.targetSpreadIndex);
          }
        }
        this.preparedAdjacent = undefined;
        this.rebaseVisibleSpreadIndex(active.sourceSnapshotSpreadIndex);
        throw new Error('Prepared Rito turn artifacts are unavailable.');
      }
      try {
        await this.session.adoptForeground({
          sessionId: source.sessionId,
          expectedVisibleArtifactId: source.artifactId,
          candidateArtifactId: target.artifactId,
        });
      } catch (error) {
        const targetSlot = this.slots.get(active.targetSpreadIndex);
        if (targetSlot?.artifactId === active.targetArtifactId) {
          if (active.previousTargetSlot) {
            this.slots.set(active.targetSpreadIndex, active.previousTargetSlot);
          } else {
            this.slots.delete(active.targetSpreadIndex);
          }
        }
        this.preparedAdjacent = undefined;
        this.rebaseVisibleSpreadIndex(active.sourceSnapshotSpreadIndex);
        throw error;
      }
      this.assignArtifact(active.targetSpreadIndex, target, true);
      this.visibleIndex = active.targetSpreadIndex;
      this.totalSpreadsValue =
        target.bookPageCount !== undefined
          ? spreadCountFromBookPages(target.bookPageCount, this.spreadMode)
          : this.totalSpreadsValue;
      if (this.lastTurnSourceId !== undefined && this.lastTurnSourceId !== source.artifactId) {
        const staleSource = this.session.getArtifact(this.lastTurnSourceId);
        if (staleSource) await this.releaseAfterNavigation(staleSource);
      }
      this.lastTurnSourceId = source.artifactId;
      this.preparedAdjacent = undefined;
      this.pruneSlots();
      readerDiagnostic(
        'turn.backend.commit.ready',
        () => `candidate=${prepared.id} spread=${this.visibleIndex} artifact=${target.artifactId.toString()}`,
      );
    });
  }
  async cancelPreparedAdjacent(prepared: ReaderPreparedAdjacent, sourceSnapshotSpreadIndex: number): Promise<void> {
    await this.operationQueue.enqueue(async () => {
      const active = this.preparedAdjacent;
      if (!active || active.id !== prepared.id) return;
      const targetSlot = this.slots.get(active.targetSpreadIndex);
      if (targetSlot?.artifactId === active.targetArtifactId) {
        if (active.previousTargetSlot) {
          this.slots.set(active.targetSpreadIndex, active.previousTargetSlot);
        } else {
          this.slots.delete(active.targetSpreadIndex);
        }
      }
      this.preparedAdjacent = undefined;
      await this.session.releaseArtifact(active.targetArtifactId).catch(() => undefined);
      this.rebaseVisibleSpreadIndex(sourceSnapshotSpreadIndex);
      this.pruneSlots();
      readerDiagnostic(
        'turn.backend.cancel.ready',
        () =>
          `candidate=${prepared.id} sourceSpread=${sourceSnapshotSpreadIndex} artifact=${active.sourceArtifactId.toString()}`,
      );
    });
  }
  rebaseVisibleSpreadIndex(spreadIndex: number): void {
    const target = Math.max(0, Math.round(spreadIndex));
    const delta = target - this.visibleIndex;
    this.rebaseSlots(delta);
    readerDiagnostic('slot.restore', () => `target=${target} delta=${delta} visibleIndex=${this.visibleIndex}`);
  }
  get totalPages() {
    return Math.max(
      1,
      this.availableArtifacts.reduce((max, artifact) => {
        const end =
          artifact.bookPageCount ??
          (artifact.bookPageIndex === undefined ? 0 : artifact.bookPageIndex + artifact.localPageIndexes.length);
        return Math.max(max, end);
      }, 0),
    );
  }
  get totalSpreads() {
    return this.totalSpreadsValue;
  }
  get chapters() {
    return this.spine
      .map((item) => {
        const pages = this.availableArtifacts.filter(
          (artifact) => artifact.locator.href === item.href || artifact.locator.href.startsWith(`${item.href}#`),
        );
        if (pages.length === 0) return undefined;
        const startPage = Math.min(...pages.map((artifact) => artifact.bookPageIndex ?? artifact.localPageIndex));
        const endPage = Math.max(
          ...pages.map(
            (artifact) => (artifact.bookPageIndex ?? artifact.localPageIndex) + artifact.localPageIndexes.length - 1,
          ),
        );
        return { spineIdref: item.idref, startPage, endPage };
      })
      .filter(
        (
          range,
        ): range is {
          spineIdref: string;
          startPage: number;
          endPage: number;
        } => range !== undefined,
      );
  }
  get chapterTimings() {
    return [];
  }
  async resolveToc(href: string): Promise<number | undefined> {
    return this.operationQueue.enqueue(() => this.resolveTocQueued(href));
  }

  private async resolveTocQueued(href: string): Promise<number | undefined> {
    readerDiagnostic(
      'toc.begin',
      () => `href=${href} visibleIndex=${this.visibleIndex} visible=${describeArtifact(this.currentArtifact)}`,
    );
    const source = this.currentArtifact;
    if (!source) return undefined;
    const resolvedHref = resolvePublicationHref(source.locator.href, href, this.spine);
    const targetBase = resolvedHref.split('#', 1)[0];
    const rawAnchor = resolvedHref.includes('#') ? resolvedHref.slice(resolvedHref.indexOf('#') + 1) : undefined;
    let targetAnchor = rawAnchor ? safeDecode(rawAnchor) : undefined;

    if (targetAnchor === undefined) {
      const tocTarget = findTocTarget(this.tocValue, resolvedHref, targetBase);
      if (tocTarget?.includes('#')) {
        targetAnchor = safeDecode(tocTarget.slice(tocTarget.indexOf('#') + 1));
      }
    }

    const existing = this.findArtifactForTocTarget(targetBase, resolvedHref, targetAnchor);
    if (existing !== undefined && existing === this.visibleIndex) return existing;

    const targetSpineIndex = this.spine.findIndex(
      (item) => item.href === targetBase || safeDecode(item.href) === safeDecode(targetBase),
    );
    if (targetSpineIndex < 0 || this.session.currentVisibleArtifactId === undefined) return undefined;
    const canonicalTargetBase = this.spine[targetSpineIndex]!.href;

    const targetIndex = this.visibleIndex;
    const sourceSlot = this.slots.get(targetIndex);
    const artifact = await this.session.requestArtifact({
      ...this.artifactRequest,
      requestId: this.session.nextRequestId,
      locator: {
        href: canonicalTargetBase,
        anchorId: targetAnchor,
      },
    });
    readerDiagnostic(
      'toc.candidate',
      () => `href=${href} targetSpread=${targetIndex} artifact=${describeArtifact(artifact)}`,
    );
    try {
      await this.prepare(artifact, targetIndex, true);
      const preparedSlot = this.slots.get(targetIndex);
      if (sourceSlot) this.slots.set(targetIndex, sourceSlot);
      await this.session.adoptForeground({
        sessionId: artifact.sessionId,
        expectedVisibleArtifactId: source.artifactId,
        candidateArtifactId: artifact.artifactId,
      });
      if (preparedSlot) this.slots.set(targetIndex, preparedSlot);
    } catch (error) {
      if (sourceSlot) this.slots.set(targetIndex, sourceSlot);
      else this.slots.delete(targetIndex);
      await this.session.releaseArtifact(artifact.artifactId).catch(() => undefined);
      throw error;
    }
    this.assignArtifact(targetIndex, artifact);
    this.totalSpreadsValue =
      artifact.bookPageCount === undefined
        ? this.totalSpreadsValue
        : spreadCountFromBookPages(artifact.bookPageCount, this.spreadMode);
    await this.releaseAfterNavigation(source);
    this.pruneSlots();
    readerDiagnostic(
      'toc.commit',
      () =>
        `href=${resolvedHref} spread=${targetIndex} artifact=${describeArtifact(artifact)} released=${source.artifactId.toString()}`,
    );
    return targetIndex;
  }

  private findArtifactForTocTarget(targetBase: string, href: string, targetAnchor?: string): number | undefined {
    const artifact = this.availableArtifacts.find((candidate) =>
      artifactMatchesTocTarget(candidate, targetBase, href, targetAnchor),
    );
    return artifact === undefined ? undefined : this.indexForArtifact(artifact);
  }

  async resolveTextRangeGeometry(
    request: import('../../contracts').ReaderTextRangeGeometryRequest,
  ): Promise<readonly import('../../contracts').ReaderTextRangeRect[]> {
    // Page indexes are chapter-local. Retained turn sources can have the same
    // index as the visible page, but their text positions describe another layout.
    const artifact = this.currentArtifact;
    if (!artifact?.localPageIndexes.includes(request.pageIndex)) return [];
    return this.operationQueue.enqueue(async () => {
      if (this.closed || this.currentArtifact?.artifactId !== artifact.artifactId) return [];
      const geometry = await this.session.textRangeGeometry({
        sessionId: artifact.sessionId,
        artifactId: artifact.artifactId,
        pageIndex: request.pageIndex,
        start: request.start,
        end: request.end,
      });
      return geometry.rects;
    });
  }

  async resolveExactSourceRange(
    request: import('../../contracts').ReaderExactSourceRangeRequest,
  ): Promise<import('../../contracts').ReaderExactSourceRangeResolution> {
    const artifact = this.currentArtifact;
    if (!artifact || this.closed) return { status: 'unavailable', selectedText: '', rects: [] };
    return this.operationQueue.enqueue(async () => {
      if (this.closed || this.currentArtifact?.artifactId !== artifact.artifactId) {
        return { status: 'unavailable', selectedText: '', rects: [] };
      }
      const resolution = await (
        this.session as RitoReaderSession & {
          resolveExactSourceRange(request: {
            sessionId: bigint;
            artifactId: bigint;
            href: string;
            range: {
              start: { nodePath: readonly number[]; textOffset: bigint };
              end: { nodePath: readonly number[]; textOffset: bigint };
            };
          }): Promise<{
            status: 'resolved' | 'pending' | 'unavailable';
            firstPageIndex?: number;
            selectedText: string;
            rects: readonly import('../../contracts').ReaderExactSourceRangeRect[];
          }>;
        }
      ).resolveExactSourceRange({
        sessionId: artifact.sessionId,
        artifactId: artifact.artifactId,
        href: request.href,
        range: {
          start: {
            nodePath: request.sourceRange.start.nodePath,
            textOffset: BigInt(request.sourceRange.start.textOffset),
          },
          end: { nodePath: request.sourceRange.end.nodePath, textOffset: BigInt(request.sourceRange.end.textOffset) },
        },
      });
      return {
        status: resolution.status,
        firstPageIndex: resolution.firstPageIndex,
        selectedText: resolution.selectedText,
        rects: resolution.rects.map((rect) => ({
          pageIndex: rect.pageIndex,
          bounds: rect.bounds,
          blockIndex: rect.blockIndex,
          lineIndex: rect.lineIndex,
          runIndex: rect.runIndex,
          startCharIndex: rect.startCharIndex,
          endCharIndex: rect.endCharIndex,
        })),
      };
    });
  }

  async resolveLocator(locator: ReaderLocator): Promise<number | undefined> {
    return this.operationQueue.enqueue(async () => {
      const source = this.currentArtifact;
      if (!source || this.preparedAdjacent) return undefined;
      const href = locator.manifestHref ?? this.spine.find((item) => item.idref === locator.spineIdref)?.href;
      if (!href || !this.spine.some((item) => item.href === href)) return undefined;
      const targetIndex = this.visibleIndex;
      const sourceSlot = this.slots.get(targetIndex);
      const artifact = await this.session.requestArtifact({
        ...this.artifactRequest,
        requestId: this.session.nextRequestId,
        locator: toRitoSavedLocator(locator, href),
      });
      try {
        await this.prepare(artifact, targetIndex, true);
        const preparedSlot = this.slots.get(targetIndex);
        if (sourceSlot) this.slots.set(targetIndex, sourceSlot);
        await this.session.adoptForeground({
          sessionId: artifact.sessionId,
          expectedVisibleArtifactId: source.artifactId,
          candidateArtifactId: artifact.artifactId,
        });
        if (preparedSlot) this.slots.set(targetIndex, preparedSlot);
      } catch (error) {
        if (sourceSlot) this.slots.set(targetIndex, sourceSlot);
        else this.slots.delete(targetIndex);
        await this.session.releaseArtifact(artifact.artifactId).catch(() => undefined);
        throw error;
      }
      this.assignArtifact(targetIndex, artifact);
      this.totalSpreadsValue =
        artifact.bookPageCount === undefined
          ? this.totalSpreadsValue
          : spreadCountFromBookPages(artifact.bookPageCount, this.spreadMode);
      await this.releaseAfterNavigation(source);
      this.pruneSlots();
      return targetIndex;
    });
  }

  async readFootnote(
    key: string,
    spreadIndex = this.visibleIndex,
  ): Promise<import('../../contracts').ReaderFootnote | undefined> {
    const artifactId = this.slots.get(spreadIndex)?.artifactId;
    const artifact = artifactId === undefined ? undefined : this.session.getArtifact(artifactId);
    if (!artifact || !key) return undefined;
    const footnote = await this.session.readFootnote(artifact.artifactId, key);
    return {
      key: footnote.key,
      kind: footnote.kind,
      text: footnote.text,
      html: footnote.html,
    };
  }

  async search(
    request: import('../../contracts').ReaderSearchRequest,
  ): Promise<import('../../contracts').ReaderSearchResponse> {
    const artifact = this.currentArtifact;
    if (!artifact)
      return {
        query: request.query,
        truncated: false,
        searchedPageCount: 0,
        results: [],
      };
    const response = await this.session.search({
      sessionId: artifact.sessionId,
      artifactId: artifact.artifactId,
      query: request.query,
      caseSensitive: request.caseSensitive,
      wholeWord: request.wholeWord,
      limit: request.limit,
    });
    return {
      query: response.query,
      truncated: response.truncated,
      searchedPageCount: response.searchedPageCount,
      results: response.results.map((result) => ({
        pageIndex: result.pageIndex,
        spreadIndex: result.spreadIndex,
        start: result.start,
        end: result.end,
        context: result.context,
        locator: result.locator
          ? {
              spineIdref: this.spine.find((item) => item.href === result.locator?.href)?.idref ?? result.locator.href,
              manifestHref: result.locator.href,
              anchorId: result.locator.anchorId,
              chapterProgress: result.locator.progression ?? 0,
              sourcePoint: result.locator.sourcePoint
                ? {
                    nodePath: result.locator.sourcePoint.nodePath,
                    textOffset: safeTextOffset(result.locator.sourcePoint.textOffset),
                  }
                : undefined,
              sourceRange: result.locator.sourceRange
                ? {
                    start: {
                      nodePath: result.locator.sourceRange.start.nodePath,
                      textOffset: safeTextOffset(result.locator.sourceRange.start.textOffset),
                    },
                    end: {
                      nodePath: result.locator.sourceRange.end.nodePath,
                      textOffset: safeTextOffset(result.locator.sourceRange.end.textOffset),
                    },
                  }
                : undefined,
            }
          : undefined,
      })),
    };
  }

  private indexForArtifact(artifact: RitoArtifact): number {
    for (const [spreadIndex, slot] of this.slots) {
      if (slot.artifactId === artifact.artifactId) return spreadIndex;
    }
    return this.visibleIndex;
  }

  async advanceBackground(): Promise<import('@umbrae-labs/rito-rn').RitoBackgroundAdvance> {
    const backgroundStartedAt = readerPerformanceStart('reader.backend.background');
    let result!: import('@umbrae-labs/rito-rn').RitoBackgroundAdvance;
    const run = this.operationQueue.enqueue(async () => {
      const visibleId = this.session.currentVisibleArtifactId;
      if (!visibleId) throw new Error('Rito background pagination requires a visible artifact.');
      const current = this.session.getArtifact(visibleId);
      if (!current) throw new Error('Rito visible artifact is unavailable.');
      readerDiagnostic('bg.begin', () => `visibleIndex=${this.visibleIndex} artifact=${describeArtifact(current)}`);
      const advance = await this.session.advanceBackground({
        sessionId: current.sessionId,
        expectedVisibleArtifactId: current.artifactId,
      });
      result = advance;
      readerDiagnostic(
        'bg.result',
        () =>
          `state=${advance.state} moves=${String(advance.movesVisibleContent)} replaces=${advance.replacesArtifactId.toString()} candidate=${describeArtifact(advance.artifact)}`,
      );
      const candidate = advance.artifact;
      if (!candidate) return;
      if (advance.movesVisibleContent) {
        await this.session.releaseArtifact(candidate.artifactId).catch(() => undefined);
        return;
      }
      if (this.session.currentVisibleArtifactId !== current.artifactId) {
        readerDiagnostic(
          'bg.drop.stale',
          () =>
            `expected=${current.artifactId.toString()} actual=${this.session.currentVisibleArtifactId?.toString() ?? 'none'} candidate=${candidate.artifactId.toString()}`,
        );
        await this.session.releaseArtifact(candidate.artifactId).catch(() => undefined);
        return;
      }
      const currentIndex = this.indexForArtifact(current);
      // The publication candidate has a new artifact identity. The slot may
      // retain a frame from the previous artifact, but that frame cannot be
      // published under the candidate until its source identity is refreshed.
      // `prepare` only rebuilds the lightweight ReaderRenderFrame; the
      // rendering layer can still reuse the compiled Picture by renderKey.
      const currentSlot = this.slots.get(currentIndex);
      if (!currentSlot?.frame || currentSlot.frame.sourceKey !== artifactSourceKey(candidate)) {
        await this.prepare(candidate, currentIndex, true, true);
      }
      this.assignArtifact(currentIndex, candidate);
      if (this.session.currentVisibleArtifactId !== current.artifactId) {
        await this.session.releaseArtifact(candidate.artifactId).catch(() => undefined);
        return;
      }
      await this.session.adoptBackground({
        sessionId: current.sessionId,
        expectedVisibleArtifactId: current.artifactId,
        candidateArtifactId: candidate.artifactId,
      });
      this.visibleIndex = currentIndex;
      if (candidate.bookPageCount !== undefined) {
        this.totalSpreadsValue = spreadCountFromBookPages(candidate.bookPageCount, this.spreadMode);
      }
      await this.releaseAfterNavigation(current);
      this.pruneSlots();
      readerDiagnostic(
        'bg.commit',
        () =>
          `spread=${currentIndex} artifact=${describeArtifact(candidate)} released=${current.artifactId.toString()}`,
      );
    }, 'background');
    try {
      await run;
      return result;
    } finally {
      if (backgroundStartedAt !== undefined)
        readerPerformanceActivity('backend.background', performance.now() - backgroundStartedAt);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.operationQueue.drain();
    const artifactIds = new Set([
      ...[...this.slots.values()].map((slot) => slot.artifactId),
      ...this.retainedBoundaryArtifacts.values(),
      ...this.retainedBoundaryKeepAlive,
    ]);
    if (this.lastTurnSourceId !== undefined) artifactIds.add(this.lastTurnSourceId);
    if (this.preparedAdjacent) {
      artifactIds.add(this.preparedAdjacent.sourceArtifactId);
      artifactIds.add(this.preparedAdjacent.targetArtifactId);
      if (this.preparedAdjacent.previousTargetSlot) {
        artifactIds.add(this.preparedAdjacent.previousTargetSlot.artifactId);
      }
    }
    this.slots.clear();
    this.loadedFonts.clear();
    this.retainedBoundaryArtifacts.clear();
    this.retainedBoundaryKeepAlive.length = 0;
    this.lastTurnSourceId = undefined;
    this.preparedAdjacent = undefined;
    for (const artifactId of artifactIds) await this.session.releaseArtifact(artifactId).catch(() => undefined);
    await this.session.dispose();
  }

  private get currentArtifact(): RitoArtifact | undefined {
    return this.session.currentVisibleArtifact;
  }

  private get availableArtifacts(): RitoArtifact[] {
    const artifacts: RitoArtifact[] = [];
    for (const slot of this.slots.values()) {
      const artifact = this.session.getArtifact(slot.artifactId);
      if (artifact) artifacts.push(artifact);
    }
    return artifacts;
  }

  private artifactForSpread(spreadIndex: number): RitoArtifact | undefined {
    const artifactId = this.slots.get(spreadIndex)?.artifactId;
    return artifactId === undefined ? undefined : this.session.getArtifact(artifactId);
  }

  private assignArtifact(spreadIndex: number, artifact: RitoArtifact, preserveFrame = false): void {
    const current = this.slots.get(spreadIndex);
    const frameBelongsToArtifact = current?.frame?.sourceKey === artifactSourceKey(artifact);
    this.slots.set(spreadIndex, {
      artifactId: artifact.artifactId,
      ...(frameBelongsToArtifact && (preserveFrame || current?.artifactId === artifact.artifactId) && current?.frame
        ? { frame: current.frame }
        : {}),
    });
    readerDiagnostic(
      'slot.assign',
      () =>
        `spread=${spreadIndex} artifact=${describeArtifact(artifact)} previous=${current?.artifactId.toString() ?? 'none'} preserveFrame=${String(preserveFrame)}`,
    );
  }

  private async releaseAfterNavigation(artifact: RitoArtifact): Promise<void> {
    if (!this.isChapterBoundaryArtifact(artifact)) {
      await this.session.releaseArtifact(artifact.artifactId).catch(() => undefined);
      return;
    }
    const key = boundaryArtifactKey(artifact);
    const previous = this.retainedBoundaryArtifacts.get(key);
    if (previous === artifact.artifactId) return;
    if (previous !== undefined) {
      // The boundary page was re-published under a new identity. Keep the old
      // identity alive briefly instead of releasing it: the engine's exact
      // locator cache can only match the next backward seek against the
      // seek-resolved href+progression locator that the old identity carries.
      await this.keepBoundaryArtifactAlive(previous);
    }
    this.retainedBoundaryArtifacts.set(key, artifact.artifactId);
    readerDiagnostic(
      'boundary.retain',
      () => `key=${key} artifact=${describeArtifact(artifact)} retained=${this.retainedBoundaryArtifacts.size}`,
    );
    while (this.retainedBoundaryArtifacts.size > RETAINED_BOUNDARY_ARTIFACT_CAP) {
      const oldest = this.retainedBoundaryArtifacts.entries().next().value as [string, bigint] | undefined;
      if (!oldest) break;
      this.retainedBoundaryArtifacts.delete(oldest[0]);
      await this.keepBoundaryArtifactAlive(oldest[1]);
      readerDiagnostic(
        'boundary.release',
        () => `key=${oldest[0]} artifact=${oldest[1].toString()} retained=${this.retainedBoundaryArtifacts.size}`,
      );
    }
  }

  /** Defers the release of a boundary artifact so recent chapters stay cacheable. */
  private async keepBoundaryArtifactAlive(artifactId: bigint): Promise<void> {
    if (this.retainedBoundaryKeepAlive.includes(artifactId)) return;
    this.retainedBoundaryKeepAlive.push(artifactId);
    while (this.retainedBoundaryKeepAlive.length > RETAINED_BOUNDARY_KEEP_ALIVE_CAP) {
      const oldest = this.retainedBoundaryKeepAlive.shift();
      if (oldest === undefined) break;
      // The newest identity of a retained key lives in the map; only release
      // artifacts that are no longer referenced anywhere.
      if (![...this.retainedBoundaryArtifacts.values()].includes(oldest)) {
        await this.session.releaseArtifact(oldest).catch(() => undefined);
        readerDiagnostic('boundary.keepalive.release', () => `artifact=${oldest.toString()}`);
      }
    }
  }

  private isChapterBoundaryArtifact(artifact: RitoArtifact): boolean {
    return artifact.navigation.previous === 'chapter-boundary' || artifact.navigation.next === 'chapter-boundary';
  }

  private pruneSlots(): void {
    const minimum = this.visibleIndex - RETAINED_SLOT_RADIUS;
    const maximum = this.visibleIndex + RETAINED_SLOT_RADIUS;
    for (const spreadIndex of this.slots.keys()) {
      if (spreadIndex < minimum || spreadIndex > maximum) this.slots.delete(spreadIndex);
    }
  }

  private rebaseSlots(delta: number): void {
    if (delta === 0) return;
    const entries = [...this.slots.entries()];
    this.slots.clear();
    for (const [spreadIndex, slot] of entries) {
      const rebasedIndex = spreadIndex + delta;
      this.slots.set(rebasedIndex, {
        artifactId: slot.artifactId,
        ...(slot.frame ? { frame: { ...slot.frame, spreadIndex: rebasedIndex } } : {}),
      });
    }
    this.visibleIndex += delta;
  }
}

function spreadCountFromBookPages(pageCount: number, spreadMode: 'single' | 'double'): number {
  if (spreadMode === 'single') return Math.max(1, pageCount);
  return Math.max(1, Math.ceil(pageCount / 2));
}

function artifactSourceKey(artifact: RitoArtifact): string {
  // Artifact identity also covers interaction metadata such as hit maps and
  // source locators. Two pages can share an identical display-list digest
  // while belonging to different chapters, so the digest alone cannot guard
  // a frame cache slot.
  return `${artifact.revisionId.toString()}:${artifact.artifactId.toString()}`;
}

function artifactRenderKey(artifact: RitoArtifact, images: ReaderImageByteCache | undefined): string {
  // Rito already supplies SHA-256 of the encoded display commands. Hashing
  // the full wire payload again on the JavaScript thread delays every turn.
  const digest = bytesToHex(artifact.displayList.semanticDigest);
  const imageKeys = artifact.resources
    .filter((resource) => resource.kind === 'image')
    .map((resource) => `${resource.href}:${byteHash(images?.get(resource.href))}`)
    .join('|');
  return `${artifact.width}x${artifact.height}:${artifact.displayList.commandCount}:${digest}:${imageKeys}`;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

const imageByteHashes = new WeakMap<Uint8Array, string>();

function byteHash(bytes: Uint8Array | undefined): string {
  if (!bytes) return 'none';
  const cached = imageByteHashes.get(bytes);
  if (cached) return cached;
  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  const digest = (hash >>> 0).toString(16).padStart(8, '0');
  imageByteHashes.set(bytes, digest);
  return digest;
}

function boundaryArtifactKey(artifact: RitoArtifact): string {
  return `${artifact.locator.href}:${artifact.localPageIndex}:${artifact.localSpreadIndex}`;
}

function describeArtifact(artifact: RitoArtifact | undefined): string {
  if (!artifact) return 'none';
  return [
    `id=${artifact.artifactId.toString()}`,
    `rev=${artifact.revisionId.toString()}`,
    `href=${artifact.locator.href}`,
    `localPage=${artifact.localPageIndex}`,
    `localSpread=${artifact.localSpreadIndex}`,
    `pageIndexes=${artifact.localPageIndexes.join(',')}`,
    `nav=${artifact.navigation.previous}/${artifact.navigation.next}`,
    `book=${artifact.bookPageIndex ?? 'none'}/${artifact.bookPageCount ?? 'none'}`,
  ].join(' ');
}

function describeError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const value = error as {
    readonly status?: unknown;
    readonly message?: unknown;
  };
  return `status=${String(value.status ?? 'none')} message=${String(value.message ?? error)}`;
}

function safeTextOffset(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new RangeError('Rito source text offset exceeds JavaScript safe integer range.');
  return Number(value);
}

function toReaderToc(entry: RitoTocEntry): import('../../contracts').ReaderTocEntry {
  type MutableEntry = { label: string; href: string; children: MutableEntry[] };
  const target =
    entry.target.kind === 'locator'
      ? `${entry.target.locator.href}${entry.target.locator.anchorId ? `#${entry.target.locator.anchorId}` : ''}`
      : entry.target.href;
  const root: MutableEntry = { label: entry.label, href: target, children: [] };
  const visited = new Set<RitoTocEntry>([entry]);
  const stack: { source: RitoTocEntry; output: MutableEntry }[] = [{ source: entry, output: root }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    for (let index = current.source.children.length - 1; index >= 0; index -= 1) {
      const child = current.source.children[index];
      if (visited.has(child)) continue;
      visited.add(child);
      const childTarget =
        child.target.kind === 'locator'
          ? `${child.target.locator.href}${child.target.locator.anchorId ? `#${child.target.locator.anchorId}` : ''}`
          : child.target.href;
      const childOutput: MutableEntry = {
        label: child.label,
        href: childTarget,
        children: [],
      };
      current.output.children.unshift(childOutput);
      stack.push({ source: child, output: childOutput });
    }
  }
  return root;
}

function findTocTarget(
  entries: readonly import('../../contracts').ReaderTocEntry[],
  href: string,
  base: string,
): string | undefined {
  const stack = [...entries].reverse();
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) continue;
    if (entry.href === href || entry.href === base) return entry.href;
    for (let index = entry.children.length - 1; index >= 0; index -= 1) {
      stack.push(entry.children[index]);
    }
  }
  return undefined;
}

function artifactMatchesTocTarget(
  artifact: RitoArtifact,
  targetBase: string,
  href: string,
  targetAnchor?: string,
): boolean {
  return (
    (artifact.locator.href === targetBase || artifact.locator.href === href) &&
    (!targetAnchor || artifact.locator.anchorId === targetAnchor)
  );
}

function toReaderLocator(
  locator: import('@umbrae-labs/rito-rn').RitoLocator,
  spine: readonly RitoPublication['spine'][number][],
): import('../../contracts').ReaderLocator {
  return {
    spineIdref: spine.find((item) => item.href === locator.href)?.idref ?? locator.href,
    manifestHref: locator.href,
    anchorId: locator.anchorId,
    chapterProgress: locator.progression ?? 0,
    sourcePoint: locator.sourcePoint
      ? {
          nodePath: locator.sourcePoint.nodePath,
          textOffset: safeTextOffset(locator.sourcePoint.textOffset),
        }
      : undefined,
    sourceRange: locator.sourceRange
      ? {
          start: {
            nodePath: locator.sourceRange.start.nodePath,
            textOffset: safeTextOffset(locator.sourceRange.start.textOffset),
          },
          end: {
            nodePath: locator.sourceRange.end.nodePath,
            textOffset: safeTextOffset(locator.sourceRange.end.textOffset),
          },
        }
      : undefined,
  };
}

function createTocLabelIndex(
  entries: readonly import('../../contracts').ReaderTocEntry[],
): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  const visited = new Set<import('../../contracts').ReaderTocEntry>();
  const stack = [...entries].reverse();
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry || visited.has(entry)) continue;
    visited.add(entry);
    if (!labels.has(entry.href)) labels.set(entry.href, entry.label);
    const base = entry.href.split('#', 1)[0];
    if (!labels.has(base)) labels.set(base, entry.label);
    for (let index = entry.children.length - 1; index >= 0; index -= 1) {
      stack.push(entry.children[index]);
    }
  }
  return labels;
}

function toReaderSemanticNode(
  node: import('@umbrae-labs/rito-rn').RitoSemanticNode,
): import('../../contracts').ReaderSemanticNode {
  return {
    role: node.role === 'list-item' ? 'listitem' : node.role,
    level: node.level,
    label: node.text,
    alt: node.alt,
    href: node.href,
    bounds: node.bounds,
    children: node.children.map(toReaderSemanticNode),
  };
}

function createArtifactRequest(
  request: ReaderOpenRequest,
  layout: ReaderLayoutRequest,
  revisionId: number,
  operationId: number,
  initialHref: string,
): import('../../rito/rito-native').RitoArtifactRequest {
  const typography = request.typography;
  const margins = resolveLayoutMargins(layout);
  const locator = request.restorePosition?.locator;
  // The override is deliberately a name Rito never registers: it exists to stop
  // the book's own `@font-face` families from leading the cascade, not to pick a
  // face. Rito rewrites every painted stack to its pinned aliases and drops any
  // named family it did not itself register, so the pinned policy is what
  // actually selects the body face. Passing the chosen family here would be a
  // no-op at best, and at worst an EPUB `@font-face` of the same name would
  // survive the rewrite and shadow the reader's choice.
  const value: RitoLayoutRequest = {
    viewportWidth: layout.viewport.width,
    viewportHeight: layout.viewport.height,
    ...margins,
    spreadMode: typography.spreadMode,
    firstPageAlone: typography.spreadMode === 'double',
    spreadGap: 0,
    rootFontSize: typography.fontSize,
    lineHeightOverride: typography.lineHeight,
    fontFamilyOverride: LUNAR_READER_FONT_FAMILY,
    renderRatio: layout.viewport.pixelRatio,
  };
  return {
    sessionId: BigInt(Math.max(1, revisionId)),
    requestId: BigInt(Math.max(1, operationId)),
    layout: value,
    locator: {
      href: locator?.manifestHref ?? initialHref,
      anchorId: locator?.anchorId,
      sourcePoint: locator?.sourcePoint
        ? {
            nodePath: locator.sourcePoint.nodePath,
            textOffset: BigInt(Math.max(0, locator.sourcePoint.textOffset)),
          }
        : undefined,
      sourceRange: locator?.sourceRange
        ? {
            start: {
              nodePath: locator.sourceRange.start.nodePath,
              textOffset: BigInt(Math.max(0, locator.sourceRange.start.textOffset)),
            },
            end: {
              nodePath: locator.sourceRange.end.nodePath,
              textOffset: BigInt(Math.max(0, locator.sourceRange.end.textOffset)),
            },
          }
        : undefined,
      progression: locator?.sourcePoint || locator?.sourceRange ? undefined : request.restorePosition?.progression,
    },
    textProfile: 'platform-string-runs',
  };
}

function toReaderLayoutParameters(layout: ReaderLayoutRequest): import('../../contracts').ReaderLayoutParameters {
  const typography = layout.typography;
  const margins = resolveLayoutMargins(layout);
  const palette =
    layout.theme === 'dark'
      ? {
          backgroundColor: '#000000',
          foregroundColor: '#FFFFFF',
          spreadBodyBackgroundColor: '#000000',
        }
      : layout.theme === 'paper'
        ? {
            backgroundColor: '#FAF9F6',
            foregroundColor: '#202020',
            spreadBodyBackgroundColor: '#FAF9F6',
          }
        : {
            backgroundColor: '#F8F8FA',
            foregroundColor: '#000000',
            spreadBodyBackgroundColor: '#F8F8FA',
          };
  return {
    viewportWidth: layout.viewport.width,
    viewportHeight: layout.viewport.height,
    pageWidth: layout.viewport.width,
    pageHeight: layout.viewport.height,
    pixelRatio: layout.viewport.pixelRatio,
    ...margins,
    spreadMode: typography.spreadMode,
    spreadGap: 0,
    rootFontSize: typography.fontSize,
    lineHeight: typography.lineHeight,
    fontFamily: typography.fonts.body.family,
    palette,
  };
}

function toReaderHitEntries(page: import('@umbrae-labs/rito-rn').RitoPage): import('../../contracts').ReaderHitEntry[] {
  let textRunIndex = 0;
  return page.hits.map((hit) => {
    const textRun = hit.imageSrc === undefined && hit.text.length > 0 ? page.textRuns[textRunIndex++] : undefined;
    const textPosition = textRun
      ? {
          blockIndex: textRun.blockIndex,
          lineIndex: textRun.lineIndex,
          runIndex: textRun.runIndex,
        }
      : undefined;
    return {
      pageIndex: hit.pageIndex,
      bounds: hit.bounds,
      text: hit.text,
      href: hit.href,
      imageSource: hit.imageSrc,
      imageAlt: hit.imageAlt,
      footnoteKey: hit.footnoteKey,
      footnotePending: hit.footnotePending,
      sourcePoint: hit.sourcePoint
        ? {
            nodePath: hit.sourcePoint.nodePath,
            textOffset: safeTextOffset(hit.sourcePoint.textOffset),
          }
        : undefined,
      textRange: textPosition
        ? {
            start: { ...textPosition, charIndex: 0 },
            end: { ...textPosition, charIndex: hit.text.length },
          }
        : undefined,
    };
  });
}

function safeDecode(val: string): string {
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
}

export function resolvePublicationHref(
  sourceHref: string,
  href: string,
  spine: readonly { readonly href: string }[],
): string {
  const fragmentIndex = href.indexOf('#');
  const fragment = fragmentIndex >= 0 ? href.slice(fragmentIndex) : '';
  const queryIndex = href.indexOf('?');
  const pathEnd = Math.min(
    fragmentIndex >= 0 ? fragmentIndex : href.length,
    queryIndex >= 0 ? queryIndex : href.length,
  );
  const rawPath = href.slice(0, pathEnd).replace(/^\/+/, '');
  const path = safeDecode(rawPath);
  const sourceClean = sourceHref.split('#', 1)[0].split('?', 1)[0];

  if (!path) return `${sourceClean}${fragment}`;

  // 1. Direct match in spine
  const directMatch = spine.find(
    (item) => item.href === path || safeDecode(item.href) === path || item.href === rawPath,
  );
  if (directMatch) return `${directMatch.href}${fragment}`;

  // 2. Resolve relative to source directory
  const sourceDirectory = sourceClean.includes('/') ? sourceClean.slice(0, sourceClean.lastIndexOf('/') + 1) : '';
  const parts: string[] = [];
  for (const part of `${sourceDirectory}${path}`.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  const relativeResolved = parts.join('/');
  const relativeMatch = spine.find(
    (item) => item.href === relativeResolved || safeDecode(item.href) === relativeResolved,
  );
  if (relativeMatch) return `${relativeMatch.href}${fragment}`;

  // 3. Basename / Suffix match fallback (e.g. "Text/chapter1.xhtml" vs "chapter1.xhtml")
  const pathFileName = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
  const suffixMatch = spine.find((item) => {
    const itemFileName = item.href.includes('/') ? item.href.slice(item.href.lastIndexOf('/') + 1) : item.href;
    return (
      item.href.endsWith(`/${path}`) ||
      path.endsWith(`/${item.href}`) ||
      itemFileName === pathFileName ||
      safeDecode(itemFileName) === safeDecode(pathFileName)
    );
  });
  if (suffixMatch) return `${suffixMatch.href}${fragment}`;

  return `${relativeResolved}${fragment}`;
}

function resolveLayoutMargins(
  layout: ReaderLayoutRequest,
): Pick<import('../../contracts').ReaderLayoutParameters, 'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft'> {
  const { contentInsets, typography } = layout;
  return {
    marginTop: typography.marginVertical + Math.max(0, contentInsets?.top ?? 0),
    marginRight: typography.marginHorizontal + Math.max(0, contentInsets?.right ?? 0),
    marginBottom: typography.marginVertical + Math.max(0, contentInsets?.bottom ?? 0),
    marginLeft: typography.marginHorizontal + Math.max(0, contentInsets?.left ?? 0),
  };
}
