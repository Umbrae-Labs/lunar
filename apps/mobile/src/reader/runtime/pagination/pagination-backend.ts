import type {
  LoadedReaderPublication,
  ReaderFontRegistry,
  ReaderImageDecoder,
  ReaderLayoutRequest,
  ReaderOpenRequest,
  ReaderRenderFrame,
  ReaderTextMeasurer,
} from '../../contracts';
import type { ReaderImageByteCache } from '../cache/reader-image-cache';

export interface ReaderPaginationBackendOpenOptions {
  readonly request: ReaderOpenRequest;
  readonly layout: ReaderLayoutRequest;
  readonly data: ArrayBuffer;
  readonly revisionId: number;
  readonly operationId: number;
  readonly signal: AbortSignal;
  readonly textMeasurer?: ReaderTextMeasurer;
  readonly fontRegistry?: ReaderFontRegistry;
  readonly imageDecoder?: ReaderImageDecoder;
  /** Runtime-owned encoded image cache shared by pagination and rendering. */
  readonly imageCache?: ReaderImageByteCache;
}

export interface ReaderPaginationBackendResult {
  readonly publication: LoadedReaderPublication;
  readonly revisionId: number;
  readonly operationId: number;
}

export interface ReaderPaginationBackend {
  open(options: ReaderPaginationBackendOpenOptions): Promise<ReaderPaginationBackendResult>;
  getFrame(revisionId: number, spreadIndex: number): Promise<ReaderRenderFrame | undefined>;
  cancel(operationId: number, revisionId: number): Promise<void>;
  close(): Promise<void>;
}

export interface ReaderBackgroundPaginationBackend extends ReaderPaginationBackend {
  advanceBackground(): Promise<unknown>;
}
