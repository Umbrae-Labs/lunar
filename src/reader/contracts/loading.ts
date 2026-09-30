import type {
  ReaderBookMetadata,
  ReaderLayoutRequest,
  ReaderLocator,
  ReaderSourcePoint,
  ReaderSourceRange,
  ReaderTocEntry,
} from './reader';
import type { ReaderResolvedPrimitiveList } from './resolved-primitives';

export interface ReaderFontShorthand {
  readonly style: 'normal' | 'italic';
  readonly weight: number;
  readonly sizePx: number;
  readonly family: string;
}

export interface ReaderMeasurePaint {
  readonly font: ReaderFontShorthand;
  readonly wordSpacingPx?: number;
  readonly letterSpacingPx?: number;
}

export interface ReaderTextMetrics {
  readonly width: number;
  readonly height: number;
}

export interface ReaderTextMeasurer {
  measureText(text: string, paint: ReaderMeasurePaint): ReaderTextMetrics;
}

export interface ReaderFontMetrics {
  readonly ascentPx: number;
  readonly descentPx: number;
  readonly lineGapPx: number;
  readonly contentHeightPx: number;
}

export interface ReaderFontMetricsProvider {
  resolveFontMetrics(paint: ReaderMeasurePaint): ReaderFontMetrics;
}

export interface ReaderFontResource {
  readonly family: string;
  readonly src: string;
  readonly bytes: Uint8Array;
  readonly weight?: string;
  readonly style?: string;
  /** Rito's shape fingerprint lets the registry share immutable faces. */
  readonly fingerprint?: string;
  readonly byteLength?: number;
}

export interface ReaderFontRegistry {
  loadFont(resource: ReaderFontResource): Promise<void>;
  dispose?(): void;
}

export interface ReaderImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface ReaderImageResource {
  readonly href: string;
  readonly bytes: Uint8Array;
}

export interface ReaderImageDecoder<TImage extends ReaderImageDimensions = ReaderImageDimensions> {
  decode(resource: ReaderImageResource): Promise<TImage>;
  dispose(image: TImage): void;
}

export interface ReaderRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type ReaderColorSpace =
  | 'srgb'
  | 'hsl'
  | 'hwb'
  | 'lab'
  | 'lch'
  | 'oklab'
  | 'oklch'
  | 'srgb-linear'
  | 'display-p3'
  | 'display-p3-linear'
  | 'a98-rgb'
  | 'prophoto-rgb'
  | 'rec2020'
  | 'xyz-d50'
  | 'xyz-d65';

export interface ReaderColor {
  readonly space: ReaderColorSpace;
  readonly components: readonly [number, number, number];
  readonly alpha: number;
  readonly none: {
    readonly component0: boolean;
    readonly component1: boolean;
    readonly component2: boolean;
    readonly alpha: boolean;
  };
}

export interface ReaderTextShadow {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly blur: number;
  readonly color: ReaderColor | string;
}

export interface ReaderDisplayList {
  readonly width: number;
  readonly height: number;
  readonly resolvedPrimitives: ReaderResolvedPrimitiveList;
}

export interface ReaderRenderPalette {
  readonly backgroundColor: string;
  readonly foregroundColor: string;
  readonly spreadBodyBackgroundColor: string;
}

export interface ReaderLayoutParameters {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly pixelRatio: number;
  readonly marginTop: number;
  readonly marginRight: number;
  readonly marginBottom: number;
  readonly marginLeft: number;
  readonly spreadMode: 'single' | 'double';
  readonly spreadGap: number;
  readonly rootFontSize: number;
  readonly lineHeight?: number;
  readonly fontFamily?: string;
  readonly palette: ReaderRenderPalette;
}

export interface ReaderChapterRange {
  readonly spineIdref: string;
  readonly startPage: number;
  readonly endPage: number;
}

export interface ReaderChapterTiming {
  readonly chapterIndex: number;
  readonly pageCount: number;
  readonly durationMs: number;
}

export interface ReaderRenderFrame {
  readonly spreadIndex: number;
  readonly manifestHref?: string;
  /** Stable artifact identity used to validate cached frames and Pictures. */
  readonly sourceKey?: string;
  /** Stable painted-content identity reusable across artifact handoffs. */
  readonly renderKey?: string;
  readonly pageIndices: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly imageSources: readonly string[];
  readonly displayList: ReaderDisplayList;
  readonly hits?: readonly ReaderHitEntry[];
  readonly semantics?: readonly ReaderSemanticNode[];
  readonly text?: string;
}

export interface ReaderTextPosition {
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly charIndex: number;
}

export interface ReaderTextRangeGeometryRequest {
  readonly pageIndex: number;
  readonly start: ReaderTextPosition;
  readonly end: ReaderTextPosition;
}

export interface ReaderTextRangeRect {
  readonly bounds: ReaderRect;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly startCharIndex: number;
  readonly endCharIndex: number;
}

export interface ReaderExactSourceRangeRequest {
  readonly href: string;
  readonly sourceRange: ReaderSourceRange;
}

export type ReaderExactSourceRangeStatus = 'resolved' | 'pending' | 'unavailable';

export interface ReaderExactSourceRangeRect extends ReaderTextRangeRect {
  readonly pageIndex: number;
}

export interface ReaderExactSourceRangeResolution {
  readonly status: ReaderExactSourceRangeStatus;
  readonly firstPageIndex?: number;
  readonly selectedText: string;
  readonly rects: readonly ReaderExactSourceRangeRect[];
}

export interface ReaderSearchRequest {
  readonly query: string;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  readonly limit?: number;
}

export interface ReaderSearchResult {
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly start: ReaderTextPosition;
  readonly end: ReaderTextPosition;
  readonly context: string;
  readonly locator?: ReaderLocator;
}

export interface ReaderSearchResponse {
  readonly query: string;
  readonly truncated: boolean;
  /** Pages searched in the current artifact's revision: one chapter or the whole book. */
  readonly searchedPageCount: number;
  readonly results: readonly ReaderSearchResult[];
}

export type ReaderFootnoteKind = 'footnote' | 'endnote' | 'rearnote' | 'note';

export interface ReaderFootnote {
  readonly key: string;
  readonly kind: ReaderFootnoteKind;
  readonly text: string;
  readonly html: string;
}

export interface ReaderHitEntry {
  readonly pageIndex: number;
  readonly bounds: ReaderRect;
  readonly text: string;
  readonly href?: string;
  readonly imageSource?: string;
  readonly imageAlt?: string;
  readonly footnoteKey?: string;
  readonly footnotePending?: boolean;
  readonly sourcePoint?: ReaderSourcePoint;
  readonly textRange?: {
    readonly start: ReaderTextPosition;
    readonly end: ReaderTextPosition;
  };
}

export type ReaderSemanticRole =
  'heading' | 'paragraph' | 'list' | 'listitem' | 'image' | 'link' | 'blockquote' | 'table' | 'generic';

export interface ReaderSemanticNode {
  readonly role: ReaderSemanticRole;
  readonly level?: number;
  readonly label?: string;
  readonly alt?: string;
  readonly href?: string;
  readonly bounds: ReaderRect;
  readonly children: readonly ReaderSemanticNode[];
}

export interface ReaderPublicationView {
  readonly metadata: ReaderBookMetadata;
  readonly toc: readonly ReaderTocEntry[];
  readonly layout: ReaderLayoutParameters;
  readonly totalPages: number;
  /** Total spreads once whole-book pagination has completed. */
  readonly totalSpreads?: number;
  readonly chapters: readonly ReaderChapterRange[];
  readonly chapterTimings: readonly ReaderChapterTiming[];
  readonly getCurrentChapterTitle?: () => string | undefined;
  /** Whole-book page number for the artifact currently assigned to a spread. */
  readonly getBookPageIndex?: (spreadIndex: number) => number | undefined;
  /** Durable source locator for the artifact currently assigned to a spread. */
  readonly getCurrentLocator?: (spreadIndex: number) => ReaderLocator | undefined;
  /** Reports whether the current artifact can produce an adjacent spread. */
  readonly canNavigate?: (direction: 'next' | 'previous') => boolean;
  /** Returns the render slot for an adjacent turn, rebasing private slots when needed. */
  readonly getAdjacentSpreadIndex?: (currentSpreadIndex: number, direction: 'next' | 'previous') => number;
  /** Relabels private render slots after a prepared turn returns to its source. */
  readonly rebaseVisibleSpreadIndex?: (spreadIndex: number) => void;
  /** Prepares an adjacent render artifact without changing the visible artifact. */
  readonly prepareAdjacent?: (
    currentSpreadIndex: number,
    direction: 'next' | 'previous',
  ) => Promise<ReaderPreparedAdjacent | undefined>;
  /** Adopts the exact artifact returned by prepareAdjacent. */
  readonly commitPreparedAdjacent?: (prepared: ReaderPreparedAdjacent) => Promise<void>;
  /** Releases the prepared artifact and restores private render slots. */
  readonly cancelPreparedAdjacent?: (
    prepared: ReaderPreparedAdjacent,
    sourceSnapshotSpreadIndex: number,
  ) => Promise<void>;
  getFrame(spreadIndex: number): ReaderRenderFrame | undefined;
  getImage(source: string): Uint8Array | undefined;
  /** Resolves a TOC target, paginating it on demand when necessary. */
  resolveToc(href: string): number | undefined | Promise<number | undefined>;
  /** Resolves a durable source location independently of render slots and typography. */
  resolveLocator?(locator: ReaderLocator): Promise<number | undefined>;
  /** Reads a note owned by the artifact assigned to a spread. */
  readFootnote?(key: string, spreadIndex?: number): Promise<ReaderFootnote | undefined>;
  resolveTextRangeGeometry?(request: ReaderTextRangeGeometryRequest): Promise<readonly ReaderTextRangeRect[]>;
  resolveExactSourceRange?(request: ReaderExactSourceRangeRequest): Promise<ReaderExactSourceRangeResolution>;
  search?(request: ReaderSearchRequest): Promise<ReaderSearchResponse>;
}

export interface ReaderPreparedAdjacent {
  readonly id: number;
  readonly direction: 'next' | 'previous';
  readonly sourceSpreadIndex: number;
  readonly targetSpreadIndex: number;
}

export interface LoadedReaderPublication extends ReaderPublicationView {
  close(): void;
}

export interface LoadReaderPublicationOptions<TImage extends ReaderImageDimensions = ReaderImageDimensions> {
  readonly data: ArrayBuffer;
  readonly layout: ReaderLayoutRequest;
  readonly textMeasurer: ReaderTextMeasurer;
  readonly fontRegistry?: ReaderFontRegistry;
  readonly imageDecoder?: ReaderImageDecoder<TImage>;
  readonly imageDecodeConcurrency?: number;
  readonly lineBreaking?: 'greedy' | 'optimal';
  readonly signal?: AbortSignal;
  readonly onChapterPaginated?: (timing: ReaderChapterTiming) => void;
}
