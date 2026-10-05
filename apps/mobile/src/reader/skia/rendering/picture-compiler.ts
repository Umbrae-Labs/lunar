import { Skia, type SkPicture } from '@shopify/react-native-skia';

import type { ReaderDisplayList } from '../../contracts';
import { isReaderPerformanceEnabled } from '../../runtime/core/performance';
import { ReaderParagraphCache, type ReaderParagraphMetrics } from '../text/paragraph-cache';
import { renderResolvedPrimitives, type ReaderPrimitiveRenderOptions } from './primitive-renderer';

export interface CompiledReaderPicture {
  readonly textMetrics?: Readonly<ReaderParagraphMetrics>;
  readonly picture: SkPicture;
  readonly width: number;
  readonly height: number;
}

export interface PictureCompiler {
  compile(displayList: ReaderDisplayList, options: ReaderPrimitiveRenderOptions): CompiledReaderPicture;
  dispose(picture: CompiledReaderPicture): void;
}

export class SkiaPictureCompiler implements PictureCompiler {
  private readonly paragraphCache = new ReaderParagraphCache();
  private paragraphFactory?: ReaderPrimitiveRenderOptions['paragraphs'];
  private fontGeneration?: number;

  clearCache(): void {
    this.paragraphCache.clear();
    this.paragraphFactory = undefined;
    this.fontGeneration = undefined;
  }

  compile(displayList: ReaderDisplayList, options: ReaderPrimitiveRenderOptions): CompiledReaderPicture {
    const fontGeneration = options.paragraphs.fonts.generation;
    if (this.paragraphFactory !== options.paragraphs || this.fontGeneration !== fontGeneration) {
      this.clearCache();
      this.paragraphFactory = options.paragraphs;
      this.fontGeneration = fontGeneration;
    }
    const width = displayList.width * options.pixelRatio;
    const height = displayList.height * options.pixelRatio;
    const recorder = Skia.PictureRecorder();
    const paragraphMetrics = isReaderPerformanceEnabled()
      ? { hits: 0, misses: 0, evictions: 0, shapeMs: 0 }
      : undefined;
    try {
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, width, height));
      renderResolvedPrimitives(canvas, displayList.resolvedPrimitives, {
        ...options,
        paragraphCache: this.paragraphCache,
        paragraphMetrics,
      });
      return {
        textMetrics: paragraphMetrics,
        picture: recorder.finishRecordingAsPicture(),
        width,
        height,
      };
    } finally {
      recorder.dispose();
    }
  }

  dispose(picture: CompiledReaderPicture): void {
    picture.picture.dispose();
  }
}
