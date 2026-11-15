import type { ReaderRect, ReaderRenderFrame, ReaderSnapshot } from '../../../contracts';
import type { CompiledReaderPicture } from '../../rendering/picture-compiler';

export type ReaderPageAnimationStyle = 'none' | 'page' | 'slide' | 'overlay' | 'pageCurl' | 'simulation';

export const READER_PAGE_ANIMATION_STYLES: readonly ReaderPageAnimationStyle[] = ['none', 'page', 'slide'];

export interface ReaderPageOverlay {
  readonly revisionId?: number;
  readonly bounds: ReaderRect;
  readonly color: string;
  readonly radius?: number;
  readonly outline?: boolean;
  readonly thickness?: number;
  readonly decoration?: 'underline' | 'wavy';
}

export interface ReaderPageContent {
  readonly key: string;
  readonly snapshot: ReaderSnapshot;
  readonly picture: CompiledReaderPicture;
  readonly frame: ReaderRenderFrame;
  readonly overlays?: readonly ReaderPageOverlay[];
  readonly bookmarked?: boolean;
}
