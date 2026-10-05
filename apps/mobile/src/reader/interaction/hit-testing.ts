import type { ReaderHitEntry, ReaderSourcePoint, ReaderTextPosition } from '../contracts';

export interface ReaderHitMap {
  readonly entries: readonly ReaderHitEntry[];
  readonly pageIndex: number;
}

export type ReaderHitTargetType = 'text' | 'link' | 'image' | 'footnote';

export interface ReaderHitTarget {
  readonly type: ReaderHitTargetType;
  readonly href?: string;
  readonly imageSource?: string;
  readonly textPosition?: ReaderTextPosition;
  readonly sourcePoint?: ReaderSourcePoint;
}

export class LinearReaderHitTester implements ReaderHitTester {
  private hitMap?: ReaderHitMap;

  setHitMap(hitMap: ReaderHitMap): void {
    this.hitMap = hitMap;
  }

  hitTest(x: number, y: number): ReaderHitTarget | undefined {
    const entries = this.hitMap?.entries;
    if (!entries) return undefined;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (!contains(entry, x, y)) continue;
      return {
        type: entry.footnoteKey ? 'footnote' : entry.imageSource ? 'image' : entry.href ? 'link' : 'text',
        href: entry.href,
        imageSource: entry.imageSource,
        sourcePoint: entry.sourcePoint,
      };
    }
    return undefined;
  }

  clear(): void {
    this.hitMap = undefined;
  }
}

function contains(entry: ReaderHitEntry, x: number, y: number): boolean {
  const bounds = entry.bounds;
  return x >= bounds.x && y >= bounds.y && x <= bounds.x + bounds.width && y <= bounds.y + bounds.height;
}

export interface ReaderHitTester {
  setHitMap(hitMap: ReaderHitMap): void;
  hitTest(x: number, y: number): ReaderHitTarget | undefined;
  clear(): void;
}
