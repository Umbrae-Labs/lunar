#include "PagerMotion.h"

#include <algorithm>
#include <cmath>

namespace lunar::reader {

namespace {

float turnLandingStart(float rootTangent) {
  const float swing =
      std::clamp((kPi - rootTangent) / kPi, 0.0f, 1.0f);
  return swing / (swing + 1.0f);
}

float profileTangentAngle(float material, const ProfileShape &shape) {
  const float airborne = 1.0f - shape.landedLength;
  if (shape.landedLength > 0 &&
      (material <= shape.landedLength || airborne <= 0.000000001f)) {
    return kPi;
  }
  const float curl =
      shape.landedLength > 0
          ? (material - shape.landedLength) / airborne
          : material;
  const float pinned = std::cos(kPi * curl);
  return shape.rotation +
         shape.bendAmplitude *
             (pinned +
              shape.curvatureUniformity *
                  (1.0f - 2.0f * curl - pinned));
}

} // namespace

MotionTuning clampMotionTuning(MotionTuning tuning) {
  // Direction selects geometry, never a second set of native-only bounds.
  const float revealStart = std::clamp(
      tuning.incomingRevealStartProgress, 0.0f, 0.85f);
  return {
      std::clamp(tuning.releaseX, 0.15f, 1.0f),
      std::clamp(tuning.liftVelocity, 0.1f, 5.0f),
      std::clamp(tuning.liftToLeft, 0.25f, 6.0f),
      std::clamp(tuning.curvatureRelaxation, 0.25f, 40.0f),
      std::clamp(tuning.incomingLandingStartProgress, 0.05f, 0.85f),
      revealStart,
      std::clamp(tuning.incomingRevealEndProgress,
                 revealStart + 0.02f, 0.95f),
      std::clamp(tuning.incomingDragProgressScale, 0.25f, 3.0f),
      std::clamp(tuning.incomingDragProgressExponent, 0.35f, 3.0f),
      std::clamp(tuning.incomingSettleDurationSeconds, 0.15f, 1.5f),
      std::clamp(tuning.incomingSettleEasingPower, 0.75f, 6.0f),
      std::clamp(tuning.incomingRevertDurationSeconds, 0.1f, 1.5f),
  };
}

PlanarMotionTuning clampPlanarMotionTuning(PlanarMotionTuning tuning) {
  const float minimumSpeed = std::clamp(
      tuning.minimumReleaseSpeedPxPerMs, 0.0f, 4.0f);
  return {
      minimumSpeed,
      std::clamp(tuning.maximumReleaseSpeedPxPerMs,
                 minimumSpeed + 0.001f, 8.0f),
      std::clamp(tuning.maximumPlaybackRate, 1.0f, 8.0f),
      std::clamp(tuning.minimumBoostedSettleMs, 0.0f, 1000.0f),
      std::clamp(tuning.maximumEaseOutBlend, 0.0f, 1.0f),
  };
}

float bendAmplitudeForChord(float chord) {
  if (chord >= 0.999999f) {
    return 0;
  }
  constexpr std::array<double, 11> coefficients = {
      2.1667709839070377,
      -0.18629174453685354,
      0.02265270180455248,
      -0.0037165828681793253,
      0.0007038952663799921,
      -0.00014500246546194032,
      0.000031566578791633,
      -0.000007135535298704449,
      0.0000016623788064225635,
      -0.0000003841457726910674,
      0.00000009309814723863693,
  };
  const double safeChord =
      std::clamp(static_cast<double>(chord),
                 static_cast<double>(kMinimumPressedEdgeX), 0.999999);
  constexpr double kApproximationMinimumChord = 0.035;
  const double x =
      (2.0 * (safeChord - kApproximationMinimumChord)) /
          (1.0 - kApproximationMinimumChord) -
      1.0;
  double beforePrevious = 0;
  double previous = 0;
  for (int index = static_cast<int>(coefficients.size()) - 1;
       index >= 1; index -= 1) {
    const double current =
        2.0 * x * previous - beforePrevious + coefficients[index];
    beforePrevious = previous;
    previous = current;
  }
  const double normalized =
      x * previous - beforePrevious + coefficients[0];
  return static_cast<float>(
      normalized * std::sqrt(std::max(0.0, 1.0 - safeChord)));
}

float pressedRollCompleteness(float edgeX) {
  const float safeEdge =
      std::clamp(edgeX, kMinimumPressedEdgeX, 1.0f);
  if (safeEdge >= 0.999999f) {
    return 0;
  }
  return std::clamp(
      bendAmplitudeForChord(safeEdge) /
          bendAmplitudeForChord(kMinimumPressedEdgeX),
      0.0f, 1.0f);
}

ProfileShape pressedShape(float edgeX, float rotation) {
  return {
      std::clamp(rotation, 0.0f, kMaximumPressedRollTilt),
      bendAmplitudeForChord(
          std::clamp(edgeX, kMinimumPressedEdgeX, 1.0f)),
      0,
      0,
  };
}

ProfileShape turnShape(float progress, float startX, float startRotation,
                       float curvatureRelaxation) {
  const float safeProgress = std::clamp(progress, 0.0f, 1.0f);
  const float startAmplitude = bendAmplitudeForChord(
      std::clamp(startX, kMinimumPressedEdgeX, 1.0f));
  const float rootTangent = startRotation + startAmplitude;
  const float landingStart = turnLandingStart(rootTangent);
  const bool landing = safeProgress > landingStart;
  const float landedLength =
      landing ? (safeProgress - landingStart) / (1.0f - landingStart)
              : 0.0f;
  const float remaining = std::clamp(1.0f - landedLength, 0.0f, 1.0f);
  const float relaxation =
      std::clamp(curvatureRelaxation, 0.25f, 40.0f);
  const float curlRetention =
      std::pow(remaining, 1.0f + relaxation / 14.0f);
  const float bendAmplitude = startAmplitude * curlRetention;
  const float swungRotation =
      landingStart > 0
          ? startRotation +
                (kPi - rootTangent) * (safeProgress / landingStart)
          : kPi - bendAmplitude;
  return {
      landing ? kPi - bendAmplitude : swungRotation,
      bendAmplitude,
      1.0f - curlRetention * curlRetention * curlRetention,
      landedLength,
  };
}

float gestureLiftRotationForFingerX(float fingerX) {
  if (fingerX <= kMinimumPressedEdgeX) {
    return kGestureHingeRotation;
  }
  const float progress = std::clamp(
      (kGestureLiftStartX - fingerX) /
          (kGestureLiftStartX - kMinimumPressedEdgeX),
      0.0f, 1.0f);
  return kGestureHingeRotation * progress;
}

float gesturePressedChordForFingerX(float fingerX, float rotation) {
  if (fingerX <= kMinimumPressedEdgeX) {
    return kGestureHingeChordX;
  }
  const float targetEdge =
      std::clamp(fingerX, kMinimumPressedEdgeX, 1.0f);
  return std::clamp(
      targetEdge / std::max(0.000001f, std::cos(rotation)),
      kMinimumPressedEdgeX, 1.0f);
}

float postHingeTurnProgress(float fingerX, float startBookX,
                            float curvatureRelaxation) {
  const float linearProgress = std::clamp(
      (kMinimumPressedEdgeX - std::clamp(fingerX, -1.0f, 1.0f)) /
          (kMinimumPressedEdgeX +
           std::clamp(startBookX, 0.0f, 1.0f)),
      0.0f, 1.0f);
  if (linearProgress <= 0 || linearProgress >= 1) {
    return linearProgress;
  }
  const float desiredRotation =
      kGestureHingeRotation +
      (kPi - kGestureHingeRotation) * linearProgress;
  const float rootTangent =
      kGestureHingeRotation + kGestureHingeBendAmplitude;
  const float swingAngle = std::max(0.0f, kPi - rootTangent);
  const float swingProgress = swingAngle / kPi;
  const float landingStart = swingProgress / (swingProgress + 1.0f);
  const float landingRotation = kPi - kGestureHingeBendAmplitude;
  if (desiredRotation <= landingRotation && swingAngle > 0.000000001f) {
    return landingStart *
           ((desiredRotation - kGestureHingeRotation) / swingAngle);
  }
  const float relaxation =
      std::clamp(curvatureRelaxation, 0.25f, 40.0f);
  const float curlRetention = std::clamp(
      (kPi - desiredRotation) / kGestureHingeBendAmplitude,
      0.0f, 1.0f);
  const float remainingAirborne = std::pow(
      curlRetention, 1.0f / (1.0f + relaxation / 14.0f));
  const float landedLength = 1.0f - remainingAirborne;
  return landingStart + landedLength * (1.0f - landingStart);
}

float incomingPageDragProgress(float progress, const MotionTuning &tuning) {
  return std::clamp(
      std::pow(std::clamp(progress, 0.0f, 1.0f),
               tuning.incomingDragProgressExponent) *
          tuning.incomingDragProgressScale,
      0.0f, 1.0f);
}

float incomingPageShapeProgress(float progress, const MotionTuning &tuning) {
  const float safeProgress = std::clamp(progress, 0.0f, 1.0f);
  if (safeProgress <= tuning.incomingRevealEndProgress) {
    return tuning.incomingLandingStartProgress;
  }
  const float landingProgress =
      (safeProgress - tuning.incomingRevealEndProgress) /
      std::max(0.000001f, 1.0f - tuning.incomingRevealEndProgress);
  return tuning.incomingLandingStartProgress +
         (1.0f - tuning.incomingLandingStartProgress) * landingProgress;
}

float incomingPageRevealProgress(float progress, const MotionTuning &tuning) {
  return std::clamp(
      (std::clamp(progress, 0.0f, 1.0f) -
       tuning.incomingRevealStartProgress) /
          std::max(0.000001f,
                   tuning.incomingRevealEndProgress -
                       tuning.incomingRevealStartProgress),
      0.0f, 1.0f);
}

float incomingPageRemainingDurationMs(float progress,
                                      const MotionTuning &tuning) {
  return 1000.0f * tuning.incomingSettleDurationSeconds *
         (1.0f - std::clamp(progress, 0.0f, 1.0f)) /
         std::max(0.000001f, 1.0f - tuning.incomingRevealEndProgress);
}

float incomingPageDrivenProgress(float startProgress, float segmentProgress,
                                 const MotionTuning &tuning) {
  const float safeStart = std::clamp(startProgress, 0.0f, 1.0f);
  const float safeSegment = std::clamp(segmentProgress, 0.0f, 1.0f);
  if (safeStart < tuning.incomingRevealEndProgress) {
    const float preludeFraction =
        (tuning.incomingRevealEndProgress - safeStart) /
        std::max(0.000001f, 1.0f - safeStart);
    if (safeSegment < preludeFraction) {
      return safeStart + (1.0f - safeStart) * safeSegment;
    }
    const float landingSegment =
        (safeSegment - preludeFraction) /
        std::max(0.000001f, 1.0f - preludeFraction);
    const float eased = 1.0f - std::pow(
        1.0f - landingSegment, tuning.incomingSettleEasingPower);
    return tuning.incomingRevealEndProgress +
           (1.0f - tuning.incomingRevealEndProgress) * eased;
  }
  const float eased = 1.0f - std::pow(
      1.0f - safeSegment, tuning.incomingSettleEasingPower);
  return safeStart + (1.0f - safeStart) * eased;
}

float slideEasedProgress(float timeline, float easeOutBlend) {
  const float time = std::clamp(timeline, 0.0f, 1.0f);
  const float easeInOutQuad =
      time < 0.5f ? 2.0f * time * time
                  : 1.0f - 2.0f * (1.0f - time) * (1.0f - time);
  const float easeOutCubic =
      1.0f - std::pow(1.0f - time, 3.0f);
  const float blend = std::clamp(easeOutBlend, 0.0f, 1.0f);
  return easeInOutQuad * (1.0f - blend) + easeOutCubic * blend;
}

void buildPhysicalProfile(
    const ProfileShape &shape,
    std::array<PhysicalPoint, kProfilePointCount> &profile,
    float &maximumLift) {
  constexpr int segmentCount = kProfilePointCount - 1;
  constexpr double quadratureOffset =
      0.5 / 1.7320508075688772935;
  constexpr double quadratureWeight =
      0.5 / static_cast<double>(segmentCount);
  double x = 0;
  double depth = 0;
  maximumLift = 0;
  profile[0] = {0, 0, 0, 1};
  for (int segment = 0; segment < segmentCount; segment += 1) {
    const float firstMaterial = static_cast<float>(
        (segment + 0.5 - quadratureOffset) / segmentCount);
    const float secondMaterial = static_cast<float>(
        (segment + 0.5 + quadratureOffset) / segmentCount);
    const float firstAngle =
        profileTangentAngle(firstMaterial, shape);
    const float secondAngle =
        profileTangentAngle(secondMaterial, shape);
    x += (std::cos(firstAngle) + std::cos(secondAngle)) *
         quadratureWeight;
    depth += (std::sin(firstAngle) + std::sin(secondAngle)) *
             quadratureWeight;
    auto &point = profile[segment + 1];
    point.x = std::abs(x) < 0.0000000001
                  ? 0
                  : static_cast<float>(x);
    point.depth = std::abs(depth) < 0.0000000001
                      ? 0
                      : static_cast<float>(depth);
    maximumLift = std::max(maximumLift, point.depth);
  }
  for (int index = 0; index < kProfilePointCount; index += 1) {
    const auto &before = profile[std::max(0, index - 1)];
    const auto &after =
        profile[std::min(kProfilePointCount - 1, index + 1)];
    const float tangentX = after.x - before.x;
    const float tangentDepth = after.depth - before.depth;
    const float tangentLength =
        std::max(0.0000001f,
                 std::hypot(tangentX, tangentDepth));
    profile[index].normalX = -tangentDepth / tangentLength;
    profile[index].normalZ = tangentX / tangentLength;
  }
}

} // namespace lunar::reader
