export type ReaderTheme = 'light' | 'dark' | 'paper' | 'green';

export type ReaderSpreadMode = 'single' | 'double';

export interface ReaderViewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface ReaderContentInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export type ReaderFontSource = 'builtin' | 'imported' | 'system';

/** Parts of the reader that carry an independently selectable font. */
export type ReaderFontRole = 'body' | 'chrome';

/**
 * A persisted font choice. The host resolves it to bytes and hands the reader
 * kernel a {@link ReaderFontFace}; nothing here owns font data.
 */
export interface ReaderFontRef {
  readonly source: ReaderFontSource;
  /** Used both as Rito's family override and as the Skia registration name. */
  readonly family: string;
  /** Host-managed font asset identity; required when `source` is `imported`. */
  readonly importedFontId?: string;
}

export interface ReaderTypography {
  readonly fonts: Readonly<Record<ReaderFontRole, ReaderFontRef>>;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly marginHorizontal: number;
  readonly marginVertical: number;
  readonly spreadMode: ReaderSpreadMode;
}

/** A resolved font face. `system` faces carry no bytes and cannot measure text. */
export interface ReaderFontFace {
  readonly family: string;
  readonly source: ReaderFontSource;
  /** Present for `builtin` and `imported`. */
  readonly bytes?: Uint8Array;
  /** Present for `builtin` and `imported`; required by Rito's pinned font policy. */
  readonly sha256?: string;
}

export interface ReaderFontFaces {
  readonly body: ReaderFontFace;
  readonly chrome: ReaderFontFace;
}
