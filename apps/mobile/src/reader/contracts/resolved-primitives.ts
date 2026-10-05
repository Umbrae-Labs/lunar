/**
 * The paint vocabulary the `RITODL1` primitive list shares with the
 * engine's typed contract: rects, typed colours, border edge paints and
 * the text run body carried by the text and ruby primitives.
 */
export interface ReaderResolvedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ReaderResolvedColor {
  readonly space:
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
  readonly component0: number;
  readonly component1: number;
  readonly component2: number;
  readonly alpha: number;
  readonly none: {
    readonly component0: boolean;
    readonly component1: boolean;
    readonly component2: boolean;
    readonly alpha: boolean;
  };
}

/** The paint a text run carries: what the renderer needs to raster its
 * glyphs. The run's inline box (background band, padding, borders) and its
 * decoration line lower to primitives around the run in the engine. */
export interface ReaderResolvedRunPaint {
  readonly font: {
    readonly family: string;
    readonly sizePx: number;
    readonly weight: number;
    readonly style: 'normal' | 'italic';
  };
  readonly color: ReaderResolvedColor;
  readonly textShadows: readonly {
    readonly offsetX: number;
    readonly offsetY: number;
    readonly blur: number;
    readonly color: ReaderResolvedColor;
  }[];
}

/** The text run body the text and ruby primitives carry; every length
 * is in CSS pixels, drawn under the list's ratio. */
export interface ReaderResolvedTextRun {
  readonly text: string;
  readonly rect: ReaderResolvedRect;
  readonly paint: ReaderResolvedRunPaint;
  readonly lineHeightPx?: number | undefined;
  readonly href?: string | undefined;
  readonly sourceText?: string | undefined;
  readonly sourceTextOffset?: bigint | undefined;
  /** The origin of every cluster in text order; empty only for a run the
   * renderer still places itself. */
  readonly clusters: readonly ReaderResolvedCluster[];
}

/** Where one cluster of a run paints: the origin of the cluster starting
 * at `byte` of the run's UTF-8 text, in CSS pixels — `y` is the
 * alphabetic baseline of a text run, the em-box top of an annotation;
 * spacing, justification and ruby distribution are already applied. */
export interface ReaderResolvedCluster {
  readonly byte: number;
  readonly x: number;
  readonly y: number;
}

/**
 * `RITODL1` format version 2: the device-resolved primitive list. Every
 * coordinate is a device pixel on the grid the host rasterizes, and every
 * rule about where ink lands has been applied by the engine. Text runs
 * stay in CSS pixels and are drawn under `scale(ratio)`: glyph
 * rasterization follows the CSS font size (synthetic bold widens with
 * it), so the device size on the device grid rasters different ink. Their
 * glyph placement is still the renderer's.
 */
export interface ReaderResolvedPrimitiveList {
  readonly formatVersion: 2;
  /** Device pixels per CSS pixel the list was resolved at. */
  readonly ratio: number;
  readonly commandCount: number;
  readonly commands: readonly ReaderResolvedPrimitive[];
}

export interface ReaderResolvedDevicePoint {
  readonly x: number;
  readonly y: number;
}

/** Arc angles are radians from the +x axis; a positive sweep turns
 * clockwise on the y-down device plane. An ellipse is its own closed
 * subpath. */
export type ReaderResolvedPathOp =
  | { readonly op: 'move-to'; readonly x: number; readonly y: number }
  | { readonly op: 'line-to'; readonly x: number; readonly y: number }
  | {
      readonly op: 'arc';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      readonly start: number;
      readonly sweep: number;
    }
  | {
      readonly op: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
    }
  | {
      readonly op: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | { readonly op: 'close' };

export type ReaderResolvedDeviceTransform =
  | { readonly kind: 'rotate'; readonly radians: number }
  | { readonly kind: 'scale'; readonly sx: number; readonly sy: number }
  | { readonly kind: 'translate'; readonly dx: number; readonly dy: number };

/** What a fill declares to the theme override: the page ground, an
 * opaque block ground the ink over it was typeset against (with
 * `groundRect`, the unsnapped box it covers), or nothing. */
export type ReaderResolvedFillGround = 'none' | 'page' | 'block';

export interface ReaderResolvedTilePlan {
  readonly origin: ReaderResolvedDevicePoint;
  readonly stepX: number;
  readonly stepY: number;
  readonly columns: number;
  readonly rows: number;
}

export interface ReaderResolvedTextPrimitive extends ReaderResolvedTextRun {
  readonly kind: 'text' | 'ruby';
}

export type ReaderResolvedPrimitive =
  | { readonly kind: 'push-state' }
  | { readonly kind: 'pop-state' }
  | { readonly kind: 'translate'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'opacity'; readonly value: number }
  | {
      readonly kind: 'transform';
      readonly origin: ReaderResolvedDevicePoint;
      readonly transforms: readonly ReaderResolvedDeviceTransform[];
    }
  | { readonly kind: 'clip-path'; readonly path: readonly ReaderResolvedPathOp[] }
  | {
      readonly kind: 'fill-rect';
      readonly rect: ReaderResolvedRect;
      readonly color: ReaderResolvedColor;
      readonly ground: ReaderResolvedFillGround;
      readonly groundRect?: ReaderResolvedRect | undefined;
    }
  | {
      readonly kind: 'fill-path';
      readonly path: readonly ReaderResolvedPathOp[];
      readonly rule: 'nonzero' | 'evenodd';
      readonly color: ReaderResolvedColor;
      readonly ground: ReaderResolvedFillGround;
      readonly groundRect?: ReaderResolvedRect | undefined;
    }
  | {
      readonly kind: 'stroke-path';
      readonly path: readonly ReaderResolvedPathOp[];
      readonly width: number;
      readonly color: ReaderResolvedColor;
      readonly cap: 'butt' | 'round';
      readonly dash?: { readonly on: number; readonly off: number } | undefined;
    }
  | {
      readonly kind: 'shadow';
      readonly shape: readonly ReaderResolvedPathOp[];
      /** Gaussian sigma in device pixels. */
      readonly sigma: number;
      readonly offset: ReaderResolvedDevicePoint;
      readonly color: ReaderResolvedColor;
      readonly clipOut?: readonly ReaderResolvedPathOp[] | undefined;
    }
  | {
      readonly kind: 'draw-image';
      readonly src: string;
      readonly dest: ReaderResolvedRect;
      /** Raster-pixel subregion to sample; absent samples the whole raster. */
      readonly sourceRect?: ReaderResolvedRect | undefined;
      readonly tiles?: ReaderResolvedTilePlan | undefined;
    }
  | ReaderResolvedTextPrimitive;
