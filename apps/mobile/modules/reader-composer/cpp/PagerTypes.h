#pragma once

#include <string>

#include "PagerSkia.h"

namespace lunar::reader {

// The values the reader hands the compositor and the events it reports back.

enum class VisualKind {
  Curl,
  Slide,
};

struct Event {
  std::string id;
  std::string type;
  double epochMs;
  int direction = 0;
};

struct MotionTuning {
  float releaseX;
  float liftVelocity;
  float liftToLeft;
  float curvatureRelaxation;
  float incomingLandingStartProgress = 0.3f;
  float incomingRevealStartProgress = 0.0f;
  float incomingRevealEndProgress = 0.28f;
  float incomingDragProgressScale = 1.0f;
  float incomingDragProgressExponent = 1.0f;
  float incomingSettleDurationSeconds = 0.52f;
  float incomingSettleEasingPower = 2.0f;
  float incomingRevertDurationSeconds = 0.72f;
};

struct PlanarMotionTuning {
  float minimumReleaseSpeedPxPerMs = 0.2f;
  float maximumReleaseSpeedPxPerMs = 1.0f;
  float maximumPlaybackRate = 2.0f;
  float minimumBoostedSettleMs = 90.0f;
  float maximumEaseOutBlend = 1.0f / 3.0f;
};

/**
 * One page as the reader paints it. `textureKey` names the painted look
 * (decorations included) and is independent of the navigation `pageKey`.
 * `picture` covers the whole viewport at `pixelWidth` x `pixelHeight`; a
 * spread holds both of its pages side by side.
 */
struct PageMaterial {
  std::string pageKey;
  std::string textureKey;
  sk_sp<SkPicture> picture;
  /** Fixed chrome drawn above a sliding body; null when baked in. */
  sk_sp<SkPicture> chromePicture;
  /** The page without its bookmark ribbon, shown while a pull moves it. */
  sk_sp<SkPicture> pullPicture;
  /**
   * The reverse of a single curling page: paper with its bookmark ribbon
   * mirrored, so the ribbon stays on the corner while the edge curls back.
   * Null prints the reverse as plain paper.
   */
  sk_sp<SkPicture> backPicture;
  int pixelWidth = 0;
  int pixelHeight = 0;
  bool spread = false;
  SkColor paperColor = SK_ColorWHITE;
};

/**
 * One window of a scrolling strip: a page whose painted content runs
 * `length` view units down from its top, placed at `top` along the strip.
 * The page's picture still covers the whole viewport; the strip shows only
 * its first `length` units.
 */
struct StripWindow {
  PageMaterial page;
  float top = 0;
  float length = 0;
};

} // namespace lunar::reader
