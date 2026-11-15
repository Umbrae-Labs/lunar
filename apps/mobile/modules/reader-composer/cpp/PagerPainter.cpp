#include "PagerPainter.h"

#include <algorithm>
#include <cmath>

namespace lunar::reader {

namespace {

struct Segment {
  std::array<SkPoint, 4> positions;
  std::array<SkPoint, 4> textureCoordinates;
  std::array<SkColor, 4> colors;
  float depth;
  bool frontFacing;
};

void drawShadow(SkCanvas *canvas, float viewportWidth, float viewportHeight,
                float paperWidth, float spineX, const RenderTurn &turn) {
  if (turn.shadowStrength <= 0) {
    return;
  }
  const float centerX =
      spineX + turn.shadowCenter * paperWidth;
  const float radius = paperWidth * turn.shadowWidth;
  const SkPoint gradientPoints[] = {
      {centerX - radius, 0},
      {centerX + radius, 0},
  };
  const unsigned char alpha =
      static_cast<unsigned char>(
          std::clamp(255.0f * turn.shadowStrength, 0.0f, 87.0f));
  const std::vector<SkColor4f> colors = {
      SkColor4f::FromColor(SkColorSetARGB(0, 0, 0, 0)),
      SkColor4f::FromColor(SkColorSetARGB(alpha, 0, 0, 0)),
      SkColor4f::FromColor(SkColorSetARGB(0, 0, 0, 0)),
  };
  const std::vector<float> positions = {0.0f, 0.5f, 1.0f};
  SkGradient::Colors gradientColors(
      SkSpan(colors),
      SkSpan<const float>(positions.data(), positions.size()),
      SkTileMode::kClamp);
  SkGradient gradient(
      gradientColors, SkGradient::Interpolation::FromFlags(0));
  SkPaint paint;
  paint.setShader(SkShaders::LinearGradient(gradientPoints, gradient));
  // At most 87 alpha of black over a dark paper leaves about a dozen
  // representable levels across the whole width; undithered they show as
  // vertical bands.
  paint.setDither(true);
  canvas->drawRect(
      SkRect::MakeLTRB(std::max(0.0f, centerX - radius), 0,
                       std::min(viewportWidth, centerX + radius),
                       viewportHeight),
      paint);
}

void drawClippedPage(SkCanvas *canvas, float clipTop, float clipBottom,
                     float destinationX, float viewportWidth,
                     float viewportHeight, const sk_sp<SkImage> &image) {
  if (clipBottom <= clipTop || image == nullptr) {
    return;
  }
  canvas->save();
  canvas->clipRect(
      SkRect::MakeLTRB(0, clipTop, viewportWidth, clipBottom));
  drawBackgroundPage(canvas, destinationX, viewportWidth, viewportHeight,
                     image);
  canvas->restore();
}

} // namespace

sk_sp<SkPicture> spreadHalfPicture(const sk_sp<SkPicture> &spread,
                                   int pixelWidth, int pixelHeight,
                                   bool right) {
  if (spread == nullptr) {
    return nullptr;
  }
  const float halfWidth = static_cast<float>(halfPixelWidth(pixelWidth));
  SkPictureRecorder recorder;
  auto *canvas = recorder.beginRecording(
      SkRect::MakeWH(halfWidth, static_cast<float>(pixelHeight)));
  canvas->clipRect(
      SkRect::MakeWH(halfWidth, static_cast<float>(pixelHeight)));
  if (right) {
    canvas->translate(-static_cast<float>(pixelWidth) * 0.5f, 0);
  }
  canvas->drawPicture(spread);
  return recorder.finishRecordingAsPicture();
}

sk_sp<SkPicture> stripBandPicture(const sk_sp<SkPicture> &window,
                                  int pixelWidth, int pixelTop,
                                  int pixelHeight) {
  const SkRect bounds = SkRect::MakeWH(static_cast<float>(pixelWidth),
                                       static_cast<float>(pixelHeight));
  SkPictureRecorder recorder;
  auto *canvas = recorder.beginRecording(bounds);
  canvas->clipRect(bounds);
  canvas->translate(0, -static_cast<float>(pixelTop));
  canvas->drawPicture(window);
  return recorder.finishRecordingAsPicture();
}

int halfPixelWidth(int pixelWidth) {
  return std::max(1, (pixelWidth + 1) / 2);
}

void drawResting(SkCanvas *canvas, float viewportWidth, float viewportHeight,
                 const RestingFrame &frame) {
  // Every Skia picture view carries a composer; one that was never given
  // a page must leave its view untouched.
  if (frame.image == nullptr && frame.picture == nullptr) {
    return;
  }
  const SkRect viewport = SkRect::MakeWH(viewportWidth, viewportHeight);
  SkPaint paint;
  if (frame.offset > 0) {
    paint.setColor(frame.revealColor);
    canvas->drawRect(viewport, paint);
  }
  canvas->save();
  canvas->translate(0, frame.offset);
  paint.setColor(frame.paperColor);
  canvas->drawRect(viewport, paint);
  if (frame.image != nullptr) {
    drawBackgroundPage(canvas, 0, viewportWidth, viewportHeight,
                       frame.image);
  } else {
    drawChromePicture(canvas, viewportWidth, viewportHeight, frame.picture,
                      frame.pixelWidth, frame.pixelHeight);
  }
  drawChromePicture(canvas, viewportWidth, viewportHeight,
                    frame.chromePicture, frame.pixelWidth,
                    frame.pixelHeight);
  canvas->restore();
}

void drawBackgroundPage(SkCanvas *canvas, float destinationX,
                        float destinationWidth, float viewportHeight,
                        const sk_sp<SkImage> &image) {
  if (canvas == nullptr || image == nullptr) {
    return;
  }
  const SkRect source =
      SkRect::MakeIWH(image->width(), image->height());
  const SkRect destination =
      SkRect::MakeXYWH(destinationX, 0, destinationWidth, viewportHeight);
  canvas->drawImageRect(
      image, source, destination,
      SkSamplingOptions(SkCubicResampler{0.0f, 0.5f}), nullptr,
      SkCanvas::kFast_SrcRectConstraint);
}

void drawChromePicture(SkCanvas *canvas, float viewportWidth,
                       float viewportHeight, const sk_sp<SkPicture> &picture,
                       int pixelWidth, int pixelHeight) {
  if (picture == nullptr || pixelWidth <= 0 || pixelHeight <= 0) return;
  canvas->save();
  canvas->scale(viewportWidth / pixelWidth, viewportHeight / pixelHeight);
  canvas->drawPicture(picture);
  canvas->restore();
}

void drawSpreadBackground(SkCanvas *canvas, float viewportWidth,
                          float viewportHeight,
                          const std::vector<RenderTurn> &turns, int direction) {
  const auto oldest = std::find_if(
      turns.begin(), turns.end(),
      [](const RenderTurn &turn) { return turn.ownsBackground; });
  const auto newest = std::find_if(
      turns.rbegin(), turns.rend(),
      [](const RenderTurn &turn) { return turn.ownsBackground; });
  if (oldest == turns.end() || newest == turns.rend()) {
    return;
  }

  SkPaint paperPaint;
  paperPaint.setColor(newest->paperColor);
  canvas->drawRect(SkRect::MakeWH(viewportWidth, viewportHeight),
                   paperPaint);

  const RenderTurn &left = direction > 0 ? *oldest : *newest;
  const RenderTurn &right = direction > 0 ? *newest : *oldest;
  const float paperWidth = viewportWidth * 0.5f;
  drawBackgroundPage(canvas, 0, paperWidth, viewportHeight,
                     left.backgroundLeftImage);
  drawBackgroundPage(canvas, paperWidth, paperWidth, viewportHeight,
                     right.backgroundRightImage);
}

void drawSlideTurns(SkCanvas *canvas, float viewportWidth, float viewportHeight,
                    const std::vector<RenderTurn> &turns) {
  if (turns.empty()) {
    return;
  }
  const auto &firstTurn = turns.front();
  const int direction = firstTurn.direction;
  const auto &firstSource = direction > 0
                                ? firstTurn.frontImage
                                : firstTurn.backgroundLeftImage;
  float cumulativeProgress = 0;
  for (const auto &turn : turns) {
    cumulativeProgress +=
        std::clamp(turn.lifecycleProgress, 0.0f, 1.0f);
  }

  // Protocol 13 splits single-page planar recordings: front/left are
  // complete moving pages (including bookmarks), back/right are transparent
  // source/target chrome. Never cut a bookmark at the header boundary.
  const bool separateChrome =
      (firstTurn.sourceChromePicture != nullptr &&
       firstTurn.targetChromePicture != nullptr) ||
      (firstTurn.backImage != nullptr &&
       firstTurn.backgroundRightImage != nullptr);
  const float bodyTop = separateChrome ? 0.0f :
      std::clamp(firstTurn.fixedChromeTop, 0.0f, viewportHeight);
  const float bodyBottom = separateChrome ? viewportHeight : std::clamp(
      viewportHeight - firstTurn.fixedChromeBottom, bodyTop,
      viewportHeight);
  const auto drawStripPage = [&](size_t pageIndex,
                                 const sk_sp<SkImage> &image) {
    const float destinationX = static_cast<float>(direction) *
                               (static_cast<float>(pageIndex) -
                                cumulativeProgress) *
                               viewportWidth;
    if (destinationX <= -viewportWidth || destinationX >= viewportWidth) {
      return;
    }
    drawClippedPage(canvas, bodyTop, bodyBottom, destinationX,
                    viewportWidth, viewportHeight, image);
  };

  // Slide turns share one continuous page strip. Treating each rapid tap as
  // an independent source/target pair would redraw the next source at x=0,
  // visibly snapping the motion backwards while the preceding turn remains
  // in flight. Summing their progress preserves the exact page position
  // when a completed leading turn leaves the active array.
  drawStripPage(0, firstSource);
  for (size_t index = 0; index < turns.size(); index += 1) {
    const auto &turn = turns[index];
    const auto &target = direction > 0
                             ? turn.backgroundLeftImage
                             : turn.frontImage;
    drawStripPage(index + 1, target);
  }

  const auto &chromeTurn = turns.back();
  if (separateChrome) {
    const auto &chromePicture = chromeTurn.useTargetChrome
                                    ? chromeTurn.targetChromePicture
                                    : chromeTurn.sourceChromePicture;
    if (chromePicture != nullptr) {
      drawChromePicture(canvas, viewportWidth, viewportHeight, chromePicture,
                        chromeTurn.pixelWidth, chromeTurn.pixelHeight);
      return;
    }
    const auto &fixedChrome = chromeTurn.useTargetChrome
                                 ? chromeTurn.backgroundRightImage
                                 : chromeTurn.backImage;
    drawBackgroundPage(canvas, 0, viewportWidth, viewportHeight, fixedChrome);
    return;
  }
  const auto &chrome = chromeTurn.direction > 0
                           ? chromeTurn.backgroundLeftImage
                           : chromeTurn.frontImage;
  const float chromeTop =
      std::clamp(chromeTurn.fixedChromeTop, 0.0f, viewportHeight);
  const float chromeBottom = std::clamp(
      viewportHeight - chromeTurn.fixedChromeBottom, chromeTop,
      viewportHeight);
  drawClippedPage(canvas, 0, chromeTop, 0, viewportWidth, viewportHeight,
                  chrome);
  drawClippedPage(canvas, chromeBottom, viewportHeight, 0, viewportWidth,
                  viewportHeight, chrome);
}

void drawTurn(SkCanvas *canvas, float viewportWidth, float viewportHeight,
              const RenderTurn &turn, int faceFilter, bool drawTurnShadow) {
  const float paperWidth = turn.spread ? viewportWidth * 0.5f : viewportWidth;
  const float spineX = turn.spread ? paperWidth : 0.0f;
  if (drawTurnShadow) {
    drawShadow(canvas, viewportWidth, viewportHeight, paperWidth, spineX,
               turn);
  }

  std::vector<Segment> segments;
  segments.reserve(kProfilePointCount - 1);
  for (int index = 0; index < kProfilePointCount - 1; index += 1) {
    const auto &before = turn.profile[index];
    const auto &after = turn.profile[index + 1];
    const float beforeScale =
        std::min(
            1.34f,
            4.0f /
                std::max(0.001f, 4.0f - std::max(0.0f, before.depth)));
    const float afterScale =
        std::min(
            1.34f,
            4.0f /
                std::max(0.001f, 4.0f - std::max(0.0f, after.depth)));
    const float beforeX = spineX + before.x * paperWidth;
    const float afterX = spineX + after.x * paperWidth;
    const float beforeTop =
        viewportHeight * 0.5f - viewportHeight * 0.5f * beforeScale;
    const float beforeBottom =
        viewportHeight * 0.5f + viewportHeight * 0.5f * beforeScale;
    const float afterTop =
        viewportHeight * 0.5f - viewportHeight * 0.5f * afterScale;
    const float afterBottom =
        viewportHeight * 0.5f + viewportHeight * 0.5f * afterScale;
    const bool frontFacing = afterX >= beforeX;
    if (faceFilter != 0 && frontFacing != (faceFilter > 0)) {
      continue;
    }
    const bool sourceFacing =
        (frontFacing ? 1 : -1) == turn.direction;
    // Shaded per profile point and interpolated across the segment: one
    // flat shade per segment steps visibly where the page bends.
    const auto shadeAt = [sourceFacing](const PhysicalPoint &point) {
      const float deformation = 1.0f - std::abs(point.normalZ);
      const float curvatureShadow = deformation * 0.16f;
      const float undersideShadow =
          sourceFacing ? 0.0f : deformation * 0.055f;
      const float shade =
          1.0f - std::min(0.2f, curvatureShadow + undersideShadow);
      const auto shadeByte =
          static_cast<unsigned char>(std::round(shade * 255.0f));
      return SkColorSetARGB(255, shadeByte, shadeByte, shadeByte);
    };
    const SkColor beforeColor = shadeAt(before);
    const SkColor afterColor = shadeAt(after);
    const float materialBefore =
        static_cast<float>(index) / (kProfilePointCount - 1);
    const float materialAfter =
        static_cast<float>(index + 1) / (kProfilePointCount - 1);
    const SkImage *image =
        frontFacing || turn.backImage == nullptr ? turn.frontImage.get()
                                                 : turn.backImage.get();
    const float imageWidth = static_cast<float>(image->width());
    const float imageHeight = static_cast<float>(image->height());
    const float textureBefore =
        (frontFacing ? materialBefore : 1.0f - materialBefore) * imageWidth;
    const float textureAfter =
        (frontFacing ? materialAfter : 1.0f - materialAfter) * imageWidth;
    segments.push_back({
        {{{beforeX, beforeTop},
          {beforeX, beforeBottom},
          {afterX, afterTop},
          {afterX, afterBottom}}},
        {{{textureBefore, 0},
          {textureBefore, imageHeight},
          {textureAfter, 0},
          {textureAfter, imageHeight}}},
        {{beforeColor, beforeColor, afterColor, afterColor}},
        (before.depth + after.depth) * 0.5f,
        frontFacing,
    });
  }

  std::sort(segments.begin(), segments.end(),
            [](const Segment &left, const Segment &right) {
              return left.depth < right.depth;
            });

  // The shade darkens a dark paper by only a few levels; dithering keeps
  // that ramp from banding.
  SkPaint frontPaint;
  frontPaint.setAntiAlias(false);
  frontPaint.setDither(true);
  frontPaint.setShader(turn.frontImage->makeShader(
      SkTileMode::kClamp, SkTileMode::kClamp,
      SkSamplingOptions(SkCubicResampler{0.0f, 0.5f})));
  SkPaint backPaint;
  backPaint.setAntiAlias(false);
  backPaint.setDither(true);
  if (turn.backImage != nullptr) {
    backPaint.setShader(turn.backImage->makeShader(
        SkTileMode::kClamp, SkTileMode::kClamp,
        SkSamplingOptions(SkCubicResampler{0.0f, 0.5f})));
  } else {
    backPaint.setColor(turn.paperColor);
  }

  for (size_t runStart = 0; runStart < segments.size();) {
    const bool frontFacing = segments[runStart].frontFacing;
    size_t runEnd = runStart + 1;
    while (runEnd < segments.size() &&
           segments[runEnd].frontFacing == frontFacing) {
      runEnd += 1;
    }

    const size_t segmentCount = runEnd - runStart;
    std::vector<SkPoint> positions;
    std::vector<SkPoint> textureCoordinates;
    std::vector<SkColor> colors;
    std::vector<uint16_t> indices;
    positions.reserve(segmentCount * 4);
    textureCoordinates.reserve(segmentCount * 4);
    colors.reserve(segmentCount * 4);
    indices.reserve(segmentCount * 6);

    for (size_t index = runStart; index < runEnd; index += 1) {
      const auto &segment = segments[index];
      const auto vertexBase = static_cast<uint16_t>(positions.size());
      positions.insert(positions.end(), segment.positions.begin(),
                       segment.positions.end());
      textureCoordinates.insert(textureCoordinates.end(),
                                segment.textureCoordinates.begin(),
                                segment.textureCoordinates.end());
      colors.insert(colors.end(), segment.colors.begin(),
                    segment.colors.end());
      indices.insert(indices.end(),
                     {vertexBase, static_cast<uint16_t>(vertexBase + 1),
                      static_cast<uint16_t>(vertexBase + 2),
                      static_cast<uint16_t>(vertexBase + 2),
                      static_cast<uint16_t>(vertexBase + 1),
                      static_cast<uint16_t>(vertexBase + 3)});
    }

    const bool hasPrintedFace = frontFacing || turn.backImage != nullptr;
    auto vertices = SkVertices::MakeCopy(
        SkVertices::kTriangles_VertexMode,
        static_cast<int>(positions.size()), positions.data(),
        hasPrintedFace ? textureCoordinates.data() : nullptr, colors.data(),
        static_cast<int>(indices.size()), indices.data());
    canvas->drawVertices(vertices, SkBlendMode::kModulate,
                         frontFacing ? frontPaint : backPaint);
    runStart = runEnd;
  }
}

} // namespace lunar::reader
