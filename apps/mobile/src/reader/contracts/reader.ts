import type { ReaderContentInsets, ReaderFontFaces, ReaderTheme, ReaderTypography, ReaderViewport } from './typography';
import type { ReaderRenderPalette } from './loading';

export interface ReaderSourcePoint {
  readonly nodePath: readonly number[];
  readonly textOffset: number;
}

export interface ReaderSourceRange {
  readonly start: ReaderSourcePoint;
  readonly end: ReaderSourcePoint;
}

export interface ReaderLocator {
  readonly spineIdref: string;
  readonly manifestHref?: string;
  readonly anchorId?: string;
  readonly chapterProgress: number;
  readonly sourcePoint?: ReaderSourcePoint;
  readonly sourceRange?: ReaderSourceRange;
}

export interface ReaderPosition {
  readonly locator?: ReaderLocator;
  readonly progression: number;
  readonly pageIndex: number;
  readonly spreadIndex: number;
  /** Whole-book page number, when a publication-backed artifact provides it. */
  readonly bookPageIndex?: number;
  /** Whole-book spread number, when whole-book pagination provides it. */
  readonly bookSpreadIndex?: number;
  readonly timestamp: number;
}

export interface ReaderTocEntry {
  readonly label: string;
  readonly href: string;
  readonly children: readonly ReaderTocEntry[];
}

export interface ReaderBookMetadata {
  readonly title: string;
  readonly language: string;
  readonly identifier: string;
  readonly creator?: string;
  readonly publisher?: string;
  readonly description?: string;
}

export interface ReaderCoverAsset {
  readonly source: string;
  readonly mediaType: string;
  readonly fileExtension: string;
  readonly bytes: Uint8Array;
}

export interface ReaderBookInspection {
  readonly metadata: ReaderBookMetadata;
  readonly cover?: ReaderCoverAsset;
}

export interface ReaderOpenRequest {
  readonly bookId: string;
  readonly fileUri: string;
  readonly viewport: ReaderViewport;
  readonly contentInsets?: ReaderContentInsets;
  readonly typography: ReaderTypography;
  /** Resolved faces; absent means every role falls back to the bundled font. */
  readonly fontFaces?: ReaderFontFaces;
  readonly theme: ReaderTheme;
  /** Optional content palette, independent of application component appearance. */
  readonly palette?: ReaderRenderPalette;
  readonly restorePosition?: ReaderPosition;
}

export interface ReaderLayoutRequest {
  readonly viewport: ReaderViewport;
  readonly contentInsets?: ReaderContentInsets;
  readonly typography: ReaderTypography;
  readonly fontFaces?: ReaderFontFaces;
  readonly theme: ReaderTheme;
  readonly palette?: ReaderRenderPalette;
}

export type ReaderPhase = 'idle' | 'opening' | 'paginating' | 'ready' | 'reflowing' | 'closing' | 'error';

export interface ReaderSnapshot {
  readonly phase: ReaderPhase;
  readonly bookId?: string;
  readonly revisionId: number;
  /** Render-slot index used by the frame and picture caches. */
  readonly spreadIndex: number;
  /** Changes whenever the Skia Picture assigned to the render slot changes. */
  readonly renderId?: number;
  /** Whole-book spread number; absent for chapter-local exact seeks. */
  readonly bookSpreadIndex?: number;
  /** Chapter title resolved from the same foreground artifact as the frame. */
  readonly chapterTitle?: string;
  readonly totalSpreads?: number;
  readonly paginationComplete?: boolean;
  readonly position?: ReaderPosition;
  readonly errorMessage?: string;
}

export interface ReaderOpenResult {
  readonly metadata: ReaderBookMetadata;
  readonly toc: readonly ReaderTocEntry[];
  readonly snapshot: ReaderSnapshot;
}
