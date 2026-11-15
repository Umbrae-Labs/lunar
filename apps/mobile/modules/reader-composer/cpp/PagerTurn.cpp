#include "PagerTurn.h"

#include <algorithm>
#include <cmath>

namespace lunar::reader {

namespace {

float automaticProgressForTurn(const Turn &turn, double nowSteadyMs) {
  const double elapsed =
      std::max(0.0, nowSteadyMs - turn.startedAtSteadyMs);
  const float remainingProgress =
      static_cast<float>(elapsed / std::max(1.0, turn.durationMs));
  return std::clamp(
      turn.baseProgress +
          (1.0f - turn.baseProgress) * remainingProgress,
      0.0f, 1.0f);
}

float smoothstep(float minimum, float maximum, float value) {
  const float progress =
      std::clamp((value - minimum) / (maximum - minimum), 0.0f, 1.0f);
  return progress * progress * (3.0f - 2.0f * progress);
}

} // namespace

MotionSample sampleMotion(const Turn &turn, double nowSteadyMs) {
  if (turn.visualKind == VisualKind::Slide) {
    if (!turn.interactive) {
      const float timeline = automaticProgressForTurn(turn, nowSteadyMs);
      return {{}, slideEasedProgress(timeline, 0), timeline >= 1.0f};
    }
    if (turn.motionPhase == MotionPhase::GestureDrag) {
      return {{}, std::clamp(turn.gestureProgress, 0.0f, 1.0f), false};
    }
    const float segmentProgress = std::clamp(
        static_cast<float>(
            std::max(0.0, nowSteadyMs - turn.settleStartedAtSteadyMs) /
            std::max(0.001, turn.settleDurationMs)),
        0.0f, 1.0f);
    const float eased =
        slideEasedProgress(segmentProgress, turn.planarEaseOutBlend);
    const float targetProgress = turn.commitOnComplete ? 1.0f : 0.0f;
    const float progress =
        turn.driveStartProgress +
        (targetProgress - turn.driveStartProgress) * eased;
    return {{}, std::clamp(progress, 0.0f, 1.0f),
            segmentProgress >= 1.0f};
  }
  if (!turn.interactive) {
    const float timeline =
        automaticProgressForTurn(turn, nowSteadyMs);
    if (turn.direction < 0 && !turn.spread) {
      const float progress =
          incomingPageDrivenProgress(0, timeline, turn.tuning);
      return {
          turnShape(incomingPageShapeProgress(progress, turn.tuning),
                    turn.tuning.releaseX, 0,
                    turn.tuning.curvatureRelaxation),
          progress,
          timeline >= 1.0f,
      };
    }
    const float propagationSpeed =
        turn.tuning.liftVelocity * turn.tuning.liftToLeft *
        kPropagationSpeedScale;
    const float turnDuration =
        (turn.tuning.releaseX + 1.0f) /
        std::max(0.1f, propagationSpeed);
    const float totalDuration =
        kAutomaticPressDurationSeconds + turnDuration;
    const float pressFraction =
        kAutomaticPressDurationSeconds / totalDuration;
    if (timeline < pressFraction) {
      const float pressProgress =
          timeline / std::max(0.000001f, pressFraction);
      const float edgeX =
          1.0f + (turn.tuning.releaseX - 1.0f) * pressProgress;
      return {pressedShape(edgeX, 0), timeline, false};
    }
    const float turnProgress =
        (timeline - pressFraction) /
        std::max(0.000001f, 1.0f - pressFraction);
    return {
        turnShape(turnProgress, turn.tuning.releaseX, 0,
                  turn.tuning.curvatureRelaxation),
        timeline,
        timeline >= 1.0f,
    };
  }

  if (turn.motionPhase == MotionPhase::GestureDrag) {
    if (turn.direction < 0 && !turn.spread) {
      const float progress = turn.gestureProgress;
      return {
          turnShape(incomingPageShapeProgress(progress, turn.tuning),
                    turn.tuning.releaseX, 0,
                    turn.tuning.curvatureRelaxation),
          progress,
          false,
      };
    }
    if (turn.dragTurnProgress > 0) {
      return {
          turnShape(turn.dragTurnProgress, kGestureHingeChordX,
                    kGestureHingeRotation,
                    turn.tuning.curvatureRelaxation),
          turn.dragTurnProgress,
          false,
      };
    }
    return {
        pressedShape(turn.pressedEdgeX, turn.heldRollTilt),
        0,
        false,
    };
  }

  const float segmentProgress = std::clamp(
      static_cast<float>(
          std::max(0.0, nowSteadyMs - turn.settleStartedAtSteadyMs) /
          std::max(0.001, turn.settleDurationMs)),
      0.0f, 1.0f);
  if (turn.motionPhase == MotionPhase::GestureTurn) {
    const float progress =
        turn.driveStartProgress +
        (1.0f - turn.driveStartProgress) * segmentProgress;
    return {
        turnShape(progress, turn.driveStartX,
                  turn.driveStartRotation,
                  turn.tuning.curvatureRelaxation),
        progress,
        segmentProgress >= 1.0f,
    };
  }
  if (turn.motionPhase == MotionPhase::GestureSettle) {
    const float progress =
        incomingPageDrivenProgress(turn.driveStartProgress,
                                   segmentProgress, turn.tuning);
    return {
        turnShape(incomingPageShapeProgress(progress, turn.tuning),
                  turn.tuning.releaseX, 0,
                  turn.tuning.curvatureRelaxation),
        progress,
        segmentProgress >= 1.0f,
    };
  }
  const float eased =
      1.0f - std::pow(1.0f - segmentProgress, 3.0f);
  if (turn.direction < 0 && !turn.spread) {
    const float progress =
        turn.driveStartProgress * (1.0f - eased);
    return {
        turnShape(incomingPageShapeProgress(progress, turn.tuning),
                  turn.tuning.releaseX, 0,
                  turn.tuning.curvatureRelaxation),
        progress,
        segmentProgress >= 1.0f,
    };
  }
  const float edgeX =
      turn.driveStartX + (1.0f - turn.driveStartX) * eased;
  const float rotation =
      turn.driveStartRotation * (1.0f - eased);
  return {
      pressedShape(edgeX, rotation),
      1.0f - segmentProgress,
      segmentProgress >= 1.0f,
  };
}

void updateGestureState(Turn &turn, float fingerX, float turnProgress) {
  turn.gestureFingerX = std::clamp(fingerX, -1.0f, 1.0f);
  const float rawProgress = std::clamp(turnProgress, 0.0f, 1.0f);
  if (turn.visualKind == VisualKind::Slide) {
    turn.gestureProgress = rawProgress;
    return;
  }
  if (turn.direction < 0 && !turn.spread) {
    turn.gestureProgress = incomingPageDragProgress(rawProgress, turn.tuning);
    return;
  }
  turn.gestureProgress = rawProgress;
  if (turn.weakGrip) {
    const float travel = std::max(0.0f, 1.0f - turn.gestureFingerX);
    const float compression =
        std::min(kWeakGripMaximumCompression,
                 travel * kWeakGripCompressionPerPage);
    turn.pressedEdgeX = 1.0f - compression;
    turn.heldRollTilt = 0;
    turn.dragTurnProgress = 0;
    return;
  }
  turn.heldRollTilt =
      gestureLiftRotationForFingerX(turn.gestureFingerX);
  turn.pressedEdgeX = gesturePressedChordForFingerX(
      turn.gestureFingerX, turn.heldRollTilt);
  turn.dragTurnProgress =
      postHingeTurnProgress(turn.gestureFingerX, turn.startBookX,
                            turn.tuning.curvatureRelaxation);
}

void buildRenderProfile(Turn &turn, const ProfileShape &shape,
                        float lifecycleProgress, double nowSteadyMs,
                        RenderTurn &renderTurn) {
  std::array<PhysicalPoint, kProfilePointCount> physicalProfile;
  float maximumLift = 0;
  buildPhysicalProfile(shape, physicalProfile, maximumLift);

  float meanSpeed = 0;
  float edgeVelocityX = 0;
  float flatteningRate = 0;
  const float deltaSeconds =
      turn.hasPreviousProfile
          ? static_cast<float>(
                std::max(0.0, nowSteadyMs -
                                  turn.previousProfileAtSteadyMs) /
                1000.0)
          : 0;
  if (deltaSeconds > 0.000001f) {
    for (int index = 0; index < kProfilePointCount; index += 1) {
      meanSpeed +=
          std::hypot(
              physicalProfile[index].x -
                  turn.previousProfile[index].x,
              physicalProfile[index].depth -
                  turn.previousProfile[index].depth) /
          deltaSeconds;
    }
    meanSpeed /= kProfilePointCount;
    edgeVelocityX =
        (physicalProfile.back().x -
         turn.previousProfile.back().x) /
        deltaSeconds;
    flatteningRate =
        std::max(0.0f,
                 (turn.previousCurvature -
                  std::abs(shape.bendAmplitude)) /
                     deltaSeconds);
  }

  const float cameraBookX = turn.spread ? 0.0f : 0.5f;
  renderTurn.minimumX = 0;
  renderTurn.maximumX = 0;
  for (int index = 0; index < kProfilePointCount; index += 1) {
    const auto &physical = physicalProfile[index];
    const float directedX = physical.x * turn.direction;
    const float visibleDepth = std::max(0.0f, physical.depth);
    const float perspectiveScale =
        std::min(1.34f,
                 4.0f /
                     std::max(0.001f, 4.0f - visibleDepth));
    const float projectedX =
        cameraBookX +
        (directedX - cameraBookX) * perspectiveScale;
    renderTurn.profile[index] = {
        projectedX,
        physical.depth,
        physical.normalX * turn.direction,
        physical.normalZ,
    };
    renderTurn.minimumX =
        std::min(renderTurn.minimumX, projectedX);
    renderTurn.maximumX =
        std::max(renderTurn.maximumX, projectedX);
  }

  float incomingReveal = 1.0f;
  if (turn.direction < 0 && !turn.spread) {
    incomingReveal = incomingPageRevealProgress(
        lifecycleProgress, turn.tuning);
    if (incomingReveal < 1.0f) {
      const float projectedOffset =
          -std::max(0.0f, renderTurn.maximumX) *
          (1.0f - incomingReveal);
      for (auto &point : renderTurn.profile) {
        point.x += projectedOffset;
      }
      renderTurn.minimumX += projectedOffset;
      renderTurn.maximumX += projectedOffset;
    }
  }

  const float directedEdgeX =
      physicalProfile.back().x * turn.direction;
  const float directedEdgeVelocityX =
      edgeVelocityX * turn.direction;
  const float sourceEdgeX = directedEdgeX * turn.direction;
  const float sourceEdgeVelocityX =
      directedEdgeVelocityX * turn.direction;
  const float sourceSilhouette =
      turn.direction > 0 ? renderTurn.maximumX
                         : renderTurn.minimumX;
  const float curl = std::clamp(
      std::abs(shape.bendAmplitude) /
          kMaximumProfileBendAmplitude,
      0.0f, 1.0f);
  const float flattening =
      1.0f - std::exp(-flatteningRate / 8.0f);
  const float outwardPush =
      1.0f -
      std::exp(-std::max(0.0f, sourceEdgeVelocityX) / 1.8f);
  const float leftwardSpeed =
      std::max(0.0f, -sourceEdgeVelocityX);
  const float edgePresence =
      smoothstep(-0.035f, 0.1f, sourceEdgeX);
  const float leftwardFade =
      1.0f / (1.0f + leftwardSpeed * 0.14f);
  const float flatteningCompression =
      curl * flattening * (0.62f + outwardPush * 0.38f);
  const float baseStrength =
      0.018f + maximumLift * 0.28f + meanSpeed * 0.011f +
      flatteningCompression * 0.12f;
  renderTurn.shadowCenter = sourceSilhouette;
  renderTurn.shadowWidth = std::clamp(
      0.045f + maximumLift * 0.12f + curl * 0.035f +
          flatteningCompression * 0.045f,
      0.045f, 0.28f);
  renderTurn.shadowStrength = std::clamp(
      baseStrength * edgePresence * leftwardFade,
      0.0f, 0.34f);
  if (renderTurn.shadowStrength < 0.0005f) {
    renderTurn.shadowStrength = 0;
  }
  if (incomingReveal <= 0) {
    renderTurn.shadowStrength = 0;
  }

  turn.previousProfile = physicalProfile;
  turn.previousCurvature = std::abs(shape.bendAmplitude);
  turn.previousProfileAtSteadyMs = nowSteadyMs;
  turn.hasPreviousProfile = true;
}

} // namespace lunar::reader
