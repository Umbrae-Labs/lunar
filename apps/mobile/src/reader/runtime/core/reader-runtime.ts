import type {
  ReaderFontFace,
  ReaderLayoutRequest,
  ReaderLocator,
  ReaderFootnote,
  ReaderOpenRequest,
  ReaderOpenResult,
  ReaderSearchRequest,
  ReaderSearchResponse,
  ReaderTextRangeGeometryRequest,
  ReaderTextRangeRect,
  ReaderExactSourceRangeRequest,
  ReaderExactSourceRangeResolution,
  ReaderSnapshot,
} from '../../contracts';
import type { ReaderHitMap } from '../../interaction/hit-testing';

export type ReaderSnapshotListener = (snapshot: ReaderSnapshot) => void;

export interface ReaderRuntime {
  getSnapshot(): ReaderSnapshot;
  subscribe(listener: ReaderSnapshotListener): () => void;
  open(request: ReaderOpenRequest): Promise<ReaderOpenResult>;
  updateLayout(request: ReaderLayoutRequest): Promise<ReaderSnapshot>;
  goToSpread(spreadIndex: number): Promise<ReaderSnapshot>;
  goToToc(href: string): Promise<ReaderSnapshot>;
  goToLocator(locator: ReaderLocator): Promise<ReaderSnapshot>;
  next(): Promise<ReaderSnapshot>;
  previous(): Promise<ReaderSnapshot>;
  getCurrentHitMap(spreadIndex?: number): ReaderHitMap | undefined;
  getCurrentImageBytes(source: string): Uint8Array | undefined;
  readFootnote(key: string, spreadIndex?: number): Promise<ReaderFootnote | undefined>;
  search(request: ReaderSearchRequest): Promise<ReaderSearchResponse>;
  resolveTextRangeGeometry(request: ReaderTextRangeGeometryRequest): Promise<readonly ReaderTextRangeRect[]>;
  resolveExactSourceRange(request: ReaderExactSourceRangeRequest): Promise<ReaderExactSourceRangeResolution>;
  /**
   * Swaps the face Skia-owned chrome text paints with. Not part of pagination:
   * a chrome font change must never reflow the book. Pass `undefined` to return
   * to the bundled face.
   */
  setChromeFontFace(face: ReaderFontFace | undefined): number;
  /**
   * Changes whenever the chrome face does. Consumers subscribe rather than
   * taking a prop: chrome resolves its font during render, and a caller that
   * changed only the font has no other value to hand down that would defeat an
   * enclosing `memo`.
   */
  getChromeFontEpoch(): number;
  subscribeChromeFont(listener: () => void): () => void;
  close(): Promise<void>;
}
