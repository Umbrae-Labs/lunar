#pragma once

#include <array>

#include "PagerTypes.h"

namespace lunar::reader {

// The paper's motion as pure functions of progress: tuning bounds, the curl
// profile of a bending sheet, and the progress curves of each turn phase.

// Keep edge-on texture bands below roughly seven source pixels on a
// 1680-wide page. The extra vertices are cheap on the native render thread
// and avoid sending an entire glyph slice through one near-zero-width quad.
inline constexpr int kProfilePointCount = 257;
inline constexpr float kPi = 3.14159265358979323846f;
inline constexpr float kMinimumPressedEdgeX = 0.14f;
inline constexpr float kMaximumProfileBendAmplitude =
    2.147033481101353f;
inline constexpr float kPressedSurfaceClearance = 0.015f;
inline constexpr float kMaximumPressedRollTilt =
    kPi - kMaximumProfileBendAmplitude - kPressedSurfaceClearance;
inline constexpr float kPressedHingeTiltDistance =
    0.3565937167398107f;
inline constexpr float kSlowCommitEdgeX =
    kMinimumPressedEdgeX - kPressedHingeTiltDistance;
inline constexpr float kGestureLiftStartX = 0.36f;
inline constexpr float kGestureRollTiltRate = 0.4f;
inline constexpr float kGestureHingeRotation =
    kMaximumPressedRollTilt * kGestureRollTiltRate;
inline constexpr float kGestureHingeChordX =
    0.15148003824552042f;
inline constexpr float kGestureHingeBendAmplitude =
    2.1266855842119465f;
inline constexpr float kFullGestureStartMinimumX = 0.25f;
inline constexpr float kWeakGripMaximumCompression = 0.04f;
inline constexpr float kWeakGripCompressionPerPage = 0.2f;
inline constexpr float kAutomaticPressDurationSeconds = 0.12f;
inline constexpr float kIncomingSettleDurationSeconds = 0.52f;
inline constexpr float kPropagationSpeedScale = 1.15f;
inline constexpr float kIncomingPageLandingStartProgress = 0.3f;
inline constexpr float kIncomingPagePreludeProgress = 0.28f;
inline constexpr float kMinimumRevertInitialSpeed = 0.65f;
inline constexpr float kMaximumRevertInitialSpeed = 6.3f;
inline constexpr float kRevertEaseOutInitialSlope = 3.0f;

struct ProfileShape {
  float rotation = 0;
  float bendAmplitude = 0;
  float curvatureUniformity = 0;
  float landedLength = 0;
};

struct PhysicalPoint {
  float x = 0;
  float depth = 0;
  float normalX = 0;
  float normalZ = 1;
};

MotionTuning clampMotionTuning(MotionTuning tuning);

PlanarMotionTuning clampPlanarMotionTuning(
    PlanarMotionTuning tuning);

float bendAmplitudeForChord(float chord);

float pressedRollCompleteness(float edgeX);

ProfileShape pressedShape(float edgeX, float rotation);

ProfileShape turnShape(float progress, float startX,
                       float startRotation,
                       float curvatureRelaxation);

float gestureLiftRotationForFingerX(float fingerX);

float gesturePressedChordForFingerX(float fingerX,
                                    float rotation);

float postHingeTurnProgress(float fingerX, float startBookX,
                            float curvatureRelaxation);

float incomingPageDragProgress(float progress,
                               const MotionTuning &tuning);

float incomingPageShapeProgress(float progress,
                                const MotionTuning &tuning);

float incomingPageRevealProgress(float progress,
                                 const MotionTuning &tuning);

float incomingPageRemainingDurationMs(
    float progress, const MotionTuning &tuning);

float incomingPageDrivenProgress(float startProgress,
                                 float segmentProgress,
                                 const MotionTuning &tuning);

float slideEasedProgress(float timeline, float easeOutBlend);

void buildPhysicalProfile(
    const ProfileShape &shape,
    std::array<PhysicalPoint, kProfilePointCount> &profile,
    float &maximumLift);

} // namespace lunar::reader
