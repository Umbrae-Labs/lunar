// Input the composer takes by itself: taps, held riffles, drags and the
// benchmark's synthetic taps.

#include "PagerCompositor.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace lunar::reader {

void PagerCompositor::setInputEnabled(bool enabled) {
  std::lock_guard<std::mutex> lock(_mutex);
  _inputEnabled = enabled;
}

bool PagerCompositor::consumeInput(int direction) {
  bool accepted = false;
  {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_inputEnabled || _currentPageKey.empty()) {
      return false;
    }
    const double nowSteadyMs = steadyNowMs();
    const double nowEpochMs = epochNowMs();
    const int normalizedDirection = direction < 0 ? -1 : 1;
    // A tap that lands while another finger is actively dragging is an
    // accidental secondary contact, not a deferred page-turn intent. Claim
    // it here so the UI thread does not fall back to RN, but never enqueue
    // it for playback after the gesture releases.
    if (activeGestureLocked() != _turns.end()) {
      accepted = true;
    } else {
      // A physical tap is never deferred. Claim it only when every image
      // needed by its first frame is already texture-backed; otherwise the
      // UI-thread driver immediately falls back to the declarative lane.
      accepted = consumeStockLocked(
          normalizedDirection, nowSteadyMs, nowEpochMs, true);
    }
  }
  if (accepted) {
    _requestRedraw();
  }
  return accepted;
}

bool PagerCompositor::tryConsumeInput(int direction) {
  bool accepted = false;
  bool requestedTextureRefill = false;
  {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_inputEnabled || _currentPageKey.empty() ||
        activeGestureLocked() != _turns.end() ||
        !_pendingDirectInputs.empty()) {
      return false;
    }
    const int normalizedDirection = direction < 0 ? -1 : 1;
    const double nowSteadyMs = steadyNowMs();
    const double nowEpochMs = epochNowMs();
    accepted = consumeStockLocked(
        normalizedDirection, nowSteadyMs, nowEpochMs, true, true, true);
    requestedTextureRefill =
        !accepted && stockAvailableLocked(normalizedDirection);
  }
  if (accepted || requestedTextureRefill) {
    _requestRedraw();
  }
  return accepted;
}

bool PagerCompositor::beginGesture(int direction, float startBookX,
                                   float fingerX, float turnProgress) {
  bool accepted = false;
  {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_inputEnabled || _currentPageKey.empty()) {
      return false;
    }
    // Automatic sheets and released gestures keep animating independently.
    // Only another finger-controlled drag blocks a new interactive sheet.
    if (activeGestureLocked() != _turns.end()) {
      return false;
    }
    const int normalizedDirection = direction < 0 ? -1 : 1;
    const auto stock = std::find_if(
        _stock.begin(), _stock.end(),
        [this, normalizedDirection](const StockEntry &entry) {
          return entry.fromPageKey == _currentPageKey &&
                 entry.direction == normalizedDirection;
        });
    if (stock == _stock.end()) {
      emitStockMissLocked(normalizedDirection, epochNowMs(),
                          "gesture-stock-miss");
      return false;
    }
    stock->lastUsed = ++_stockUsageCounter;

    if (!stockTexturesReadyLocked(*stock)) {
      emitStockMissLocked(normalizedDirection, epochNowMs(),
                          "gesture-texture-miss");
      return false;
    }

    const double nowSteadyMs = steadyNowMs();
    const double nowEpochMs = epochNowMs();
    if (!beginDirectionEpochLocked(
            normalizedDirection, nowSteadyMs, nowEpochMs)) {
      emitStockMissLocked(normalizedDirection, nowEpochMs,
                          "gesture-direction-busy");
      return false;
    }
    _turns.erase(
        std::remove_if(_turns.begin(), _turns.end(),
                       [](const Turn &turn) { return turn.completed; }),
        _turns.end());
    // A newly pressed sheet starts immediately. Same-direction released
    // sheets keep their timelines; an opposite stack was retired above.
    _nextLaunchSteadyMs = nowSteadyMs;

    Turn turn;
    turn.visualKind = _visualKind;
    turn.planarTuning = _planarMotionTuning;
    turn.fixedChromeTop = _fixedChromeTop;
    turn.fixedChromeBottom = _fixedChromeBottom;
    turn.id = nextStockTurnIdLocked(stock->id);
    bindStockTurnLocked(turn, *stock);
    turn.direction = normalizedDirection;
    turn.started = true;
    turn.interactive = true;
    turn.motionPhase = MotionPhase::GestureDrag;
    turn.tuning = turn.direction == 1 ? _gestureForwardTuning
                                      : _gestureBackwardTuning;
    turn.startBookX = std::clamp(startBookX, 0.0f, 1.0f);
    turn.weakGrip =
        turn.startBookX < kFullGestureStartMinimumX;
    updateGestureState(turn, fingerX, turnProgress);
    turn.lastGestureUpdateAtSteadyMs = nowSteadyMs;
    turn.paperColor = stock->paperColor;
    turn.startedAtSteadyMs = nowSteadyMs;
    _preferredDirection = normalizedDirection;
    _events.push_back(
        {turn.id, "gesture-started", nowEpochMs, normalizedDirection});
    _turns.push_back(std::move(turn));
    accepted = true;
  }
  if (accepted) {
    _requestRedraw();
  }
  return accepted;
}

bool PagerCompositor::updateGesture(float fingerX, float turnProgress) {
  bool accepted = false;
  {
    std::lock_guard<std::mutex> lock(_mutex);
    auto turn = activeGestureLocked();
    if (turn == _turns.end() || turn->settling) {
      return false;
    }
    updateGestureState(*turn, fingerX, turnProgress);
    turn->lastGestureUpdateAtSteadyMs = steadyNowMs();
    accepted = true;
  }
  if (accepted) {
    _requestRedraw();
  }
  return accepted;
}

bool PagerCompositor::endGesture(float fingerX, float pageWidth,
                                 float throwVelocity, float throwAcceleration,
                                 float pageWeight, float commitThreshold,
                                 float slowCommitEdgeX, float minimumSpeedScale,
                                 float maximumSpeedScale, float velocityGain,
                                 float idleDecaySeconds,
                                 float releaseProjectionSeconds) {
  bool accepted = false;
  {
    std::lock_guard<std::mutex> lock(_mutex);
    auto turn = activeGestureLocked();
    if (turn == _turns.end() || turn->settling) {
      return false;
    }
    const double nowSteadyMs = steadyNowMs();
    const float safeIdleDecaySeconds =
        std::clamp(idleDecaySeconds, 0.005f, 1.0f);
    const float idleSeconds = static_cast<float>(
        std::max(0.0, nowSteadyMs - turn->lastGestureUpdateAtSteadyMs) /
        1000.0);
    const float idleDecay =
        std::exp(-idleSeconds / safeIdleDecaySeconds);
    const float decayedThrowVelocity =
        std::max(0.0f, throwVelocity) * idleDecay;
    const float decayedThrowAcceleration = throwAcceleration * idleDecay;
    if (turn->direction < 0 && !turn->spread) {
      turn->gestureFingerX = std::clamp(fingerX, -1.0f, 1.0f);
    } else {
      updateGestureState(*turn, fingerX, turn->gestureProgress);
    }
    const float safeCommitEdge =
        std::clamp(slowCommitEdgeX, -0.5f, 0.95f);
    const bool incomingPage = turn->direction < 0 && !turn->spread;
    const float commitFingerX =
        incomingPage
            ? 1.0f - turn->gestureProgress * (1.0f - safeCommitEdge)
            : std::clamp(fingerX, -1.0f, 1.0f);
    const float distance = std::clamp(
        (1.0f - commitFingerX) /
            std::max(0.05f, 1.0f - safeCommitEdge),
        0.0f, 1.2f);
    const float velocity =
        std::clamp(decayedThrowVelocity, 0.0f, 3.2f) * 0.18f;
    const float acceleration =
        std::clamp(decayedThrowAcceleration, 0.0f, 10.0f) * 0.035f;
    const float score =
        (distance + velocity + acceleration) /
        std::clamp(pageWeight, 0.25f, 3.0f);
    const bool commit = turn->visualKind == VisualKind::Slide
                            ? turn->gestureProgress +
                                      decayedThrowVelocity *
                                          std::clamp(
                                              releaseProjectionSeconds,
                                              0.0f, 1.0f) >=
                                  std::clamp(commitThreshold, 0.05f, 0.95f) -
                                      1e-6f
                            : (incomingPage || !turn->weakGrip) &&
                                  score >=
                                      std::clamp(commitThreshold, 0.15f,
                                                 1.5f) -
                                          1e-6f;
    releaseGestureLocked(
        *turn, commit, decayedThrowVelocity, minimumSpeedScale,
        maximumSpeedScale, velocityGain, pageWidth, nowSteadyMs,
        epochNowMs());
    accepted = true;
  }
  if (accepted) {
    _requestRedraw();
  }
  return accepted;
}

bool PagerCompositor::cancelGesture() {
  bool accepted = false;
  {
    std::lock_guard<std::mutex> lock(_mutex);
    auto turn = activeGestureLocked();
    if (turn == _turns.end() || turn->settling) {
      return false;
    }
    const double nowEpochMs = epochNowMs();
    _events.push_back(
        {turn->id, "gesture-released", nowEpochMs, turn->direction});
    _events.push_back(
        {turn->id, "cancelled", nowEpochMs, turn->direction});
    turn->completed = true;
    accepted = true;
  }
  if (accepted) {
    _requestRedraw();
  }
  return accepted;
}

void PagerCompositor::runBenchmark(int count, double intervalMs,
                                   int direction) {
  {
    std::lock_guard<std::mutex> lock(_mutex);
    _benchmarkRemaining = std::clamp(count, 0, 200);
    _benchmarkIntervalMs = std::clamp(intervalMs, 1.0, 1000.0);
    _benchmarkDirection = direction < 0 ? -1 : 1;
    _preferredDirection = _benchmarkDirection;
    _benchmarkNextSteadyMs = steadyNowMs();
  }
  _requestRedraw();
}

std::vector<Turn>::iterator PagerCompositor::activeGestureLocked() {
  return std::find_if(
      _turns.begin(), _turns.end(), [](const Turn &turn) {
        return turn.interactive && !turn.settling && !turn.completed;
      });
}

void PagerCompositor::consumeGestureLocked(Turn &turn, double nowEpochMs) {
  leadToPageLocked(turn.toPageKey);
  turn.logicalPageRevision = _currentPageRevision;
  _preferredDirection = turn.direction;
  _events.push_back(
      {turn.id, "consumed", nowEpochMs, turn.direction});
}

void PagerCompositor::releaseGestureLocked(
    Turn &turn, bool commit, float throwVelocity, float minimumSpeedScale,
    float maximumSpeedScale, float velocityGain, float pageWidth,
    double nowSteadyMs, double nowEpochMs) {
  turn.settling = true;
  turn.commitOnComplete = commit;
  turn.settleStartedAtSteadyMs = nowSteadyMs;
  const float safeMinimumSpeed =
      std::clamp(minimumSpeedScale, 0.1f, 4.0f);
  const float safeMaximumSpeed =
      std::clamp(maximumSpeedScale, safeMinimumSpeed, 8.0f);
  turn.driveSpeedScale = std::clamp(
      safeMinimumSpeed +
          std::max(0.0f, throwVelocity) *
              std::clamp(velocityGain, 0.0f, 4.0f),
      safeMinimumSpeed, safeMaximumSpeed);
  if (turn.visualKind == VisualKind::Slide) {
    turn.driveStartProgress = turn.gestureProgress;
    turn.motionPhase = commit ? MotionPhase::GestureTurn
                              : MotionPhase::GestureRevert;
    const float targetProgress = commit ? 1.0f : 0.0f;
    const float distance =
        std::abs(targetProgress - turn.driveStartProgress);
    const float baseDurationMs =
        static_cast<float>(turn.durationMs) * distance;
    float releaseBoost = 0;
    if (commit) {
      const float releaseSpeedPxPerMs =
          std::max(0.0f, throwVelocity) * std::max(0.0f, pageWidth) /
          1000.0f;
      releaseBoost = std::clamp(
          (releaseSpeedPxPerMs -
           turn.planarTuning.minimumReleaseSpeedPxPerMs) /
              (turn.planarTuning.maximumReleaseSpeedPxPerMs -
               turn.planarTuning.minimumReleaseSpeedPxPerMs),
          0.0f, 1.0f);
    }
    const float playbackRate =
        1.0f +
        (turn.planarTuning.maximumPlaybackRate - 1.0f) * releaseBoost;
    const float boostedDurationMs =
        releaseBoost <= 0
            ? baseDurationMs
            : std::max(
                  std::min(
                      turn.planarTuning.minimumBoostedSettleMs,
                      baseDurationMs),
                  baseDurationMs / playbackRate);
    turn.planarEaseOutBlend =
        releaseBoost * turn.planarTuning.maximumEaseOutBlend;
    turn.settleDurationMs = std::max(0.001f, boostedDurationMs);
    if (commit) {
      consumeGestureLocked(turn, nowEpochMs);
    }
    _events.push_back(
        {turn.id, "gesture-released", nowEpochMs, turn.direction});
    return;
  }
  if (turn.direction < 0 && !turn.spread) {
    turn.driveStartProgress = turn.gestureProgress;
    if (commit) {
      turn.motionPhase = MotionPhase::GestureSettle;
      turn.settleDurationMs = std::max(
          1000.0 / 60.0,
          static_cast<double>(incomingPageRemainingDurationMs(
              turn.driveStartProgress, turn.tuning)) /
              turn.driveSpeedScale);
      consumeGestureLocked(turn, nowEpochMs);
    } else {
      turn.motionPhase = MotionPhase::GestureRevert;
      turn.settleDurationMs = std::max(
          1000.0 / 60.0,
          static_cast<double>(1000.0f *
                              turn.tuning.incomingRevertDurationSeconds *
                              turn.driveStartProgress));
    }
  } else if (commit) {
    turn.motionPhase = MotionPhase::GestureTurn;
    turn.driveStartX = turn.pressedEdgeX;
    turn.driveStartProgress = turn.dragTurnProgress;
    turn.driveStartRotation = turn.heldRollTilt;
    const float propagationSpeed =
        turn.tuning.liftVelocity * turn.tuning.liftToLeft *
        kPropagationSpeedScale * turn.driveSpeedScale;
    const float remainingRotationRatio =
        (kPi - turn.driveStartRotation) / kPi;
    const float fullDuration =
        ((turn.driveStartX + 1.0f) * remainingRotationRatio) /
        std::max(0.1f, propagationSpeed);
    turn.settleDurationMs =
        std::max(0.001f,
                 1000.0f * (1.0f - turn.driveStartProgress) *
                     fullDuration);
    consumeGestureLocked(turn, nowEpochMs);
  } else {
    turn.motionPhase = MotionPhase::GestureRevert;
    turn.driveStartX =
        std::clamp(turn.pressedEdgeX, kMinimumPressedEdgeX, 1.0f);
    turn.driveStartRotation = turn.heldRollTilt;
    const float completeness =
        pressedRollCompleteness(turn.driveStartX);
    const float distance = std::max(0.0f, 1.0f - turn.driveStartX);
    const float initialSpeed =
        kMinimumRevertInitialSpeed +
        (kMaximumRevertInitialSpeed - kMinimumRevertInitialSpeed) *
            completeness;
    turn.settleDurationMs =
        distance <= 0
            ? 0.001
            : 1000.0 * kRevertEaseOutInitialSlope * distance /
                  initialSpeed;
  }
  _events.push_back(
      {turn.id, "gesture-released", nowEpochMs, turn.direction});
}

void PagerCompositor::drainPendingDirectInputsLocked(double nowSteadyMs,
                                                     double nowEpochMs) {
  while (!_pendingDirectInputs.empty()) {
    const auto pending = _pendingDirectInputs.front();
    if (!stockAvailableLocked(pending.direction) ||
        !consumeStockLocked(
            pending.direction, nowSteadyMs, nowEpochMs, true,
            false)) {
      return;
    }
    _pendingDirectInputs.pop_front();
  }
}

void PagerCompositor::processBenchmarkTaps() {
  const double nowSteadyMs = steadyNowMs();
  const double nowEpochMs = epochNowMs();
  std::lock_guard<std::mutex> lock(_mutex);
  int emitted = 0;
  while (_benchmarkRemaining > 0 &&
         nowSteadyMs >= _benchmarkNextSteadyMs && emitted < 4) {
    const int normalizedDirection = _benchmarkDirection < 0 ? -1 : 1;
    if (_pendingDirectInputs.empty() &&
        stockAvailableLocked(normalizedDirection)) {
      consumeStockLocked(normalizedDirection, nowSteadyMs, nowEpochMs,
                         true);
    } else if (_pendingDirectInputs.size() <
               kMaximumPendingDirectInputCount) {
      _pendingDirectInputs.push_back({normalizedDirection});
    } else {
      emitStockMissLocked(normalizedDirection, nowEpochMs);
    }
    _benchmarkRemaining -= 1;
    _benchmarkNextSteadyMs += _benchmarkIntervalMs;
    emitted += 1;
  }
}

} // namespace lunar::reader
