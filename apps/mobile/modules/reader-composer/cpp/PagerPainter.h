#pragma once

#include <array>
#include <cstdint>
#include <vector>

#include "PagerMotion.h"

namespace lunar::reader {

// Skia drawing of frames the compositor has already decided: resting pages,
// slide strips and curling sheets, plus the pictures derived from a page.

struct RenderTurn {
  sk_sp<SkImage> frontImage;
  sk_sp<SkImage> backImage;
  sk_sp<SkImage> backgroundLeftImage;
  sk_sp<SkImage> backgroundRightImage;
  bool ownsBackground;
  uint64_t logicalPageRevision;
  int direction;
  bool spread;
  SkColor paperColor;
  std::array<PhysicalPoint, kProfilePointCount> profile;
  float minimumX;
  float maximumX;
  float shadowCenter;
  float shadowWidth;
  float shadowStrength;
  VisualKind visualKind = VisualKind::Curl;
  float lifecycleProgress = 0;
  float fixedChromeTop = 0;
  float fixedChromeBottom = 0;
  bool useTargetChrome = true;
  sk_sp<SkPicture> sourceChromePicture;
  sk_sp<SkPicture> targetChromePicture;
  int pixelWidth = 0;
  int pixelHeight = 0;
};

/** What draw() puts on screen when no turn moves. */
struct RestingFrame {
  sk_sp<SkImage> image;
  sk_sp<SkPicture> picture;
  sk_sp<SkPicture> chromePicture;
  int pixelWidth = 0;
  int pixelHeight = 0;
  SkColor paperColor = SK_ColorWHITE;
  float offset = 0;
  SkColor revealColor = SK_ColorWHITE;
};

/**
 * One half of a spread, as its own picture: `right` selects the page right
 * of the spine. It replays the whole spread clipped, so recording costs only
 * a reference to the spread's display list.
 */
sk_sp<SkPicture> spreadHalfPicture(const sk_sp<SkPicture> &spread,
                                   int pixelWidth, int pixelHeight,
                                   bool right);

/** Rows `pixelTop` to `pixelTop + pixelHeight` of a window, as their own picture. */
sk_sp<SkPicture> stripBandPicture(const sk_sp<SkPicture> &window,
                                  int pixelWidth, int pixelTop,
                                  int pixelHeight);

int halfPixelWidth(int pixelWidth);

void drawResting(SkCanvas *canvas, float viewportWidth,
                 float viewportHeight, const RestingFrame &frame);

void drawBackgroundPage(SkCanvas *canvas, float destinationX,
                        float destinationWidth, float viewportHeight,
                        const sk_sp<SkImage> &image);

// Chrome contains only a few cached glyphs. Replaying it avoids allocating
// and uploading two viewport-sized transparent textures per planar turn.
void drawChromePicture(SkCanvas *canvas, float viewportWidth,
                       float viewportHeight,
                       const sk_sp<SkPicture> &picture,
                       int pixelWidth, int pixelHeight);

void drawSpreadBackground(
    SkCanvas *canvas, float viewportWidth, float viewportHeight,
    const std::vector<RenderTurn> &turns, int direction);

void drawSlideTurns(SkCanvas *canvas, float viewportWidth,
                    float viewportHeight,
                    const std::vector<RenderTurn> &turns);

void drawTurn(SkCanvas *canvas, float viewportWidth,
              float viewportHeight, const RenderTurn &turn,
              int faceFilter = 0, bool drawTurnShadow = true);

} // namespace lunar::reader
