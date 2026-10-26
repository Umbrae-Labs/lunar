export interface ReaderArchiveHandle {
  readonly bookHash: string;
  readEntry(path: string): Promise<Uint8Array>;
  hasEntry(path: string): boolean;
  close(): void;
}

export interface ReaderArchiveModule {
  open(uri: string): Promise<ReaderArchiveHandle>;
}

export interface ReaderBookEntry {
  readonly path: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

export interface ReaderBookExtractionResult {
  /** Names or duplicate records require the managed archive to be canonicalized. */
  readonly requiresCanonicalArchive: boolean;
}

export interface ReaderNativeTextMeasurer {
  measureText(request: {
    readonly text: string;
    readonly family: string;
    readonly weight: number;
    readonly style: 'normal' | 'italic';
    readonly sizePx: number;
    readonly letterSpacingPx?: number;
    readonly wordSpacingPx?: number;
  }): { readonly width: number; readonly height: number };
  resolveFontMetrics(request: {
    readonly family: string;
    readonly weight: number;
    readonly style: 'normal' | 'italic';
    readonly sizePx: number;
  }): {
    readonly ascentPx: number;
    readonly descentPx: number;
    readonly lineGapPx: number;
    readonly contentHeightPx: number;
  };
}
