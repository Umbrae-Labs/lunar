export interface ReaderArchiveHandle {
  readonly bookHash: string;
  readEntry(path: string): Promise<Uint8Array>;
  hasEntry(path: string): boolean;
  close(): void;
}

export interface ReaderArchiveModule {
  open(uri: string): Promise<ReaderArchiveHandle>;
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
