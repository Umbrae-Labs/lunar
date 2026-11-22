#pragma once

#include <array>
#include <cstdint>
#include <string>

#include "PagerPainter.h"

namespace lunar::reader {

// One sheet in flight: its state, how it samples its motion over time, and
// the render snapshot it hands the painter each frame.

inline constexpr double kMinimumDurationMs = 16.0;
inline constexpr double kDefaultDurationMs = 260.0;
inline constexpr double kMaximumDurationMs = 240000.0;

enum class MotionPhase {
  Automatic,
  GestureDrag,
  GestureTurn,
  GestureSettle,
  GestureRevert,
};

struct MotionSample {
  ProfileShape shape;
  float lifecycleProgress = 0;
  bool completed = false;
};

/**
 * Page-table keys of a turn's faces, named for a single forward turn of the
 * earlier page E onto the later page L: front = E, backgroundLeft = L. A
 * curling spread turns half pages: front = E right, back = L left,
 * backgroundLeft = E left, backgroundRight = L right. Empty keys draw paper.
 */
struct TurnFaces {
  std::string front;
  std::string back;
  std::string backgroundLeft;
  std::string backgroundRight;
};

struct Turn {
  VisualKind visualKind = VisualKind::Curl;
  PlanarMotionTuning planarTuning;
  std::string id;
  std::string fromPageKey;
  std::string toPageKey;
  uint64_t logicalPageRevision = 0;
  /** Page-table keys of the faces below; resolved once all are uploaded. */
  TurnFaces faces;
  bool facesBound = false;
  /** What rests on screen once this turn lands. */
  PageMaterial target;
  sk_sp<SkImage> frontImage;
  sk_sp<SkImage> backImage;
  sk_sp<SkImage> backgroundLeftImage;
  sk_sp<SkImage> backgroundRightImage;
  int pixelWidth = 0;
  int pixelHeight = 0;
  int direction = 1;
  bool spread = false;
  bool started = false;
  bool firstFrameQueued = false;
  bool firstFramePresented = false;
  bool completed = false;
  bool interactive = false;
  bool settling = false;
  bool commitOnComplete = true;
  bool weakGrip = false;
  bool hasPreviousProfile = false;
  bool directInput = false;
  bool ownsBackground = false;
  MotionPhase motionPhase = MotionPhase::Automatic;
  MotionTuning tuning = {0.72f, 1.5f, 2.2f, 6.75f};
  SkColor paperColor = SK_ColorWHITE;
  double notBeforeSteadyMs = 0;
  double startedAtSteadyMs = 0;
  double durationMs = kDefaultDurationMs;
  float baseProgress = 0;
  float gestureProgress = 0;
  float startBookX = 1;
  float gestureFingerX = 1;
  float pressedEdgeX = 1;
  float heldRollTilt = 0;
  float dragTurnProgress = 0;
  float driveStartX = 1;
  float driveStartProgress = 0;
  float driveStartRotation = 0;
  float driveSpeedScale = 1;
  float planarEaseOutBlend = 0;
  float fixedChromeTop = 0;
  float fixedChromeBottom = 0;
  float previousCurvature = 0;
  double lastGestureUpdateAtSteadyMs = 0;
  double settleStartedAtSteadyMs = 0;
  double settleDurationMs = kMinimumDurationMs;
  double previousProfileAtSteadyMs = 0;
  std::array<PhysicalPoint, kProfilePointCount> previousProfile = {};
  sk_sp<SkPicture> sourceChromePicture;
  sk_sp<SkPicture> targetChromePicture;
};

MotionSample sampleMotion(const Turn &turn, double nowSteadyMs);

void updateGestureState(Turn &turn, float fingerX,
                              float turnProgress);

void buildRenderProfile(
    Turn &turn, const ProfileShape &shape, float lifecycleProgress,
    double nowSteadyMs, RenderTurn &renderTurn);

} // namespace lunar::reader
