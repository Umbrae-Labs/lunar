#pragma once

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdocumentation"

#include "include/core/SkBlendMode.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkColor.h"
#include "include/core/SkImage.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPicture.h"
#include "include/core/SkPictureRecorder.h"
#include "include/core/SkPoint.h"
#include "include/core/SkRect.h"
#include "include/core/SkSamplingOptions.h"
#include "include/core/SkShader.h"
#include "include/core/SkSurface.h"
#include "include/core/SkTileMode.h"
#include "include/core/SkVertices.h"
#include "include/effects/SkGradient.h"
#if !defined(SK_GRAPHITE)
#include "include/gpu/ganesh/GrDirectContext.h"
#include "include/gpu/ganesh/GrTypes.h"
#include "include/gpu/ganesh/SkImageGanesh.h"
#include "include/gpu/ganesh/SkSurfaceGanesh.h"
#endif

#pragma clang diagnostic pop

class GrDirectContext;

namespace lunar::reader {

/**
 * A deliberately small native page compositor.
 *
 * React owns pagination and supplies immutable page images. Once a command is
 * accepted, however, image retention, burst compression, the animation clock,
 * paper geometry, and drawing all stay in C++. No per-frame JSI property or
 * React tree update is required.
 */
class PagerCompositor {
public:
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

  explicit PagerCompositor(std::function<void()> requestRedraw)
      : _requestRedraw(std::move(requestRedraw)) {}

  void configureMotion(int visualKind, float fixedChromeTop,
                       float fixedChromeBottom,
                       MotionTuning automaticForward,
                       MotionTuning automaticBackward,
                       MotionTuning rapidForward, MotionTuning rapidBackward,
                       MotionTuning gestureForward,
                       MotionTuning gestureBackward,
                       PlanarMotionTuning planarMotion) {
    std::lock_guard<std::mutex> lock(_mutex);
    const VisualKind nextKind =
        visualKind == 1 ? VisualKind::Slide : VisualKind::Curl;
    if (nextKind != _visualKind) {
      // Faces are derived per visual kind (a curling spread turns half
      // pages); edges stocked for the other kind can no longer be drawn.
      _stock.clear();
    }
    _visualKind = nextKind;
    _fixedChromeTop = std::max(0.0f, fixedChromeTop);
    _fixedChromeBottom = std::max(0.0f, fixedChromeBottom);
    _automaticForwardTuning = clampMotionTuning(automaticForward);
    _automaticBackwardTuning = clampMotionTuning(automaticBackward);
    _rapidForwardTuning = clampMotionTuning(rapidForward);
    _rapidBackwardTuning = clampMotionTuning(rapidBackward);
    _gestureForwardTuning = clampMotionTuning(gestureForward);
    _gestureBackwardTuning = clampMotionTuning(gestureBackward);
    _planarMotionTuning = clampPlanarMotionTuning(planarMotion);
  }

  /**
   * The page the reader runtime shows. The composer draws it at rest and
   * turns away from it; nothing else paints pages.
   *
   * - The current page again: its paint changed; no turn.
   * - A page the composer already turned to on its own, ahead of the runtime
   *   (taps, released drags): the runtime is catching up; nothing moves.
   * - Another page with a direction: a turn from the shown page to it.
   * - Otherwise, or with `force`: the composer jumps there, ending its turns.
   */
  void present(PageMaterial page, int transition, double durationMs,
               double launchIntervalMs, bool force) {
    if (page.pageKey.empty() || page.textureKey.empty() ||
        page.picture == nullptr || page.pixelWidth <= 0 ||
        page.pixelHeight <= 0) {
      return;
    }
    {
      std::lock_guard<std::mutex> lock(_mutex);
      const double nowSteadyMs = steadyNowMs();
      const double nowEpochMs = epochNowMs();
      retainPageMaterialLocked(page.textureKey, page.picture, page.pixelWidth,
                               page.pixelHeight, {});
      const auto led = std::find(_trail.begin(), _trail.end(), page.pageKey);
      if (!force && page.pageKey == _currentPageKey) {
        _trail.clear();
        _presented = std::move(page);
      } else if (!force && led != _trail.end()) {
        _trail.erase(_trail.begin(), led + 1);
      } else if (!force && transition != 0 && _trail.empty() &&
                 !_currentPageKey.empty() &&
                 _presented.pageKey == _currentPageKey &&
                 _presented.spread == page.spread &&
                 beginDirectionEpochLocked(transition, nowSteadyMs,
                                           nowEpochMs)) {
        queuePresentedTurnLocked(std::move(page), transition < 0 ? -1 : 1,
                                 durationMs, launchIntervalMs, nowSteadyMs);
      } else {
        jumpLocked(std::move(page), nowEpochMs);
      }
    }
    _requestRedraw();
  }

  /**
   * Moves the resting page down by `offset` while a bookmark pull drags it,
   * over `revealColor`. Called from the UI thread on every pull frame.
   */
  void setRestingOffset(float offset, SkColor revealColor) {
    {
      std::lock_guard<std::mutex> lock(_mutex);
      const float next = std::max(0.0f, offset);
      if (next == _restingOffset && revealColor == _revealColor) {
        return;
      }
      _restingOffset = next;
      _revealColor = revealColor;
    }
    _requestRedraw();
  }

  /**
   * Holds the edge from `source` to `target` for input the composer takes
   * by itself: a tap, a held riffle or a drag. Faces are derived here, so a
   * curling spread turns its half pages from the same two recordings.
   */
  void stockPicture(std::string id, PageMaterial source, PageMaterial target,
                    int direction, double durationMs, double rapidDurationMs,
                    double launchIntervalMs) {
    if (id.empty() || source.pageKey.empty() || target.pageKey.empty() ||
        source.textureKey.empty() || target.textureKey.empty() ||
        source.picture == nullptr || target.picture == nullptr ||
        source.spread != target.spread || target.pixelWidth <= 0 ||
        target.pixelHeight <= 0) {
      return;
    }
    {
      std::lock_guard<std::mutex> lock(_mutex);
      const int normalizedDirection = direction < 0 ? -1 : 1;
      const auto existing = std::find_if(
          _stock.begin(), _stock.end(),
          [&source, normalizedDirection](const StockEntry &entry) {
            return entry.fromPageKey == source.pageKey &&
                   entry.direction == normalizedDirection;
          });
      if (existing != _stock.end()) {
        if (existing->id == id) {
          existing->lastUsed = ++_stockUsageCounter;
          existing->durationMs =
              std::clamp(durationMs, kMinimumDurationMs, kMaximumDurationMs);
          existing->rapidDurationMs = std::clamp(
              rapidDurationMs, kMinimumDurationMs, kMaximumDurationMs);
          existing->launchIntervalMs =
              std::clamp(launchIntervalMs, 1.0, 1000.0);
          existing->paperColor = target.paperColor;
          return;
        }
        _stock.erase(existing);
      }
      // Release the distant edge before admitting its replacement's page
      // material. Doing this in the opposite order can force the bounded page
      // table to evict a picture that the still-live old graph references.
      while (_stock.size() >= kMaximumStockCount) {
        const auto pageDistances = stockPageDistancesLocked();
        auto eviction = _stock.end();
        int evictionDistance = -1;
        for (auto candidate = _stock.begin(); candidate != _stock.end();
             candidate += 1) {
          const int distance =
              stockEntryDistanceLocked(*candidate, pageDistances);
          if (eviction == _stock.end() || distance > evictionDistance ||
              (distance == evictionDistance &&
               candidate->lastUsed < eviction->lastUsed)) {
            eviction = candidate;
            evictionDistance = distance;
          }
        }
        if (eviction == _stock.end()) {
          break;
        }
        _stock.erase(eviction);
      }
      TurnFaces faces;
      if (!retainTurnFacesLocked(source, target, normalizedDirection, faces)) {
        return;
      }
      StockEntry entry;
      entry.id = std::move(id);
      entry.fromPageKey = source.pageKey;
      entry.toPageKey = target.pageKey;
      entry.sourceTextureKey = source.textureKey;
      entry.targetTextureKey = target.textureKey;
      entry.faces = std::move(faces);
      entry.pixelWidth = target.pixelWidth;
      entry.pixelHeight = target.pixelHeight;
      entry.direction = normalizedDirection;
      entry.spread = target.spread;
      entry.durationMs =
          std::clamp(durationMs, kMinimumDurationMs, kMaximumDurationMs);
      entry.rapidDurationMs =
          std::clamp(rapidDurationMs, kMinimumDurationMs, kMaximumDurationMs);
      entry.launchIntervalMs = std::clamp(launchIntervalMs, 1.0, 1000.0);
      entry.paperColor = target.paperColor;
      entry.lastUsed = ++_stockUsageCounter;
      entry.sourceChromePicture = source.chromePicture;
      entry.targetChromePicture = target.chromePicture;
      _stock.push_back(std::move(entry));
      drainPendingDirectInputsLocked(steadyNowMs(), epochNowMs());
    }
    _requestRedraw();
  }

  void setInputEnabled(bool enabled) {
    std::lock_guard<std::mutex> lock(_mutex);
    _inputEnabled = enabled;
  }

  bool consumeInput(int direction) {
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

  // A held riffle is live input, not deferred intent. Consume a stocked page
  // now or drop this cadence tick so releasing the finger is an exact stop.
  bool tryConsumeInput(int direction) {
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

  bool beginGesture(int direction, float startBookX, float fingerX,
                    float turnProgress) {
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
      updateGestureStateLocked(turn, fingerX, turnProgress);
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

  bool updateGesture(float fingerX, float turnProgress) {
    bool accepted = false;
    {
      std::lock_guard<std::mutex> lock(_mutex);
      auto turn = activeGestureLocked();
      if (turn == _turns.end() || turn->settling) {
        return false;
      }
      updateGestureStateLocked(*turn, fingerX, turnProgress);
      turn->lastGestureUpdateAtSteadyMs = steadyNowMs();
      accepted = true;
    }
    if (accepted) {
      _requestRedraw();
    }
    return accepted;
  }

  bool endGesture(float fingerX, float pageWidth, float throwVelocity,
                  float throwAcceleration, float pageWeight,
                  float commitThreshold, float slowCommitEdgeX,
                  float minimumSpeedScale, float maximumSpeedScale,
                  float velocityGain, float idleDecaySeconds,
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
        updateGestureStateLocked(*turn, fingerX, turn->gestureProgress);
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

  bool cancelGesture() {
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

  void runBenchmark(int count, double intervalMs, int direction) {
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

  void reset() {
    std::vector<Turn> turns;
    {
      std::lock_guard<std::mutex> lock(_mutex);
      turns.swap(_turns);
      _pendingPresentedTurnIds.clear();
      _events.clear();
      _stock.clear();
      _pageTextures.clear();
      _pendingDirectInputs.clear();
      _trail.clear();
      _presented = {};
      _resting = {};
      _currentPageKey.clear();
      _latestCompletedPageRevision = 0;
      _stockTurnCounter = 0;
      _preferredDirection = 1;
      _nextLaunchSteadyMs = 0;
      _benchmarkRemaining = 0;
      _restingOffset = 0;
    }
    _requestRedraw();
  }

  std::vector<Event> takeEvents() {
    std::vector<Event> events;
    {
      std::lock_guard<std::mutex> lock(_mutex);
      events.swap(_events);
    }
    return events;
  }

  // A turn is not visible merely because draw() built its geometry. Its clock
  // starts only once the display-backed provider submitted its first frame,
  // so an unavailable drawable cannot consume animation time.
  void commitPresentedFrame() {
    std::lock_guard<std::mutex> lock(_mutex);
    if (_pendingPresentedTurnIds.empty()) {
      return;
    }
    const double nowSteadyMs = steadyNowMs();
    for (const auto &turnId : _pendingPresentedTurnIds) {
      const auto turn = std::find_if(
          _turns.begin(), _turns.end(),
          [&turnId](const Turn &entry) { return entry.id == turnId; });
      if (turn == _turns.end() || turn->interactive ||
          turn->firstFramePresented) {
        continue;
      }
      turn->firstFramePresented = true;
      turn->firstFrameQueued = false;
      turn->startedAtSteadyMs = nowSteadyMs;
    }
    _pendingPresentedTurnIds.clear();
  }

  bool hasActiveTurns() const {
    std::lock_guard<std::mutex> lock(_mutex);
    return !_turns.empty() || _benchmarkRemaining > 0 ||
           !_pendingDirectInputs.empty() ||
           hasPendingPageTextureWorkLocked();
  }

  void draw(SkCanvas *canvas, float viewportWidth, float viewportHeight,
            GrDirectContext *directContext, bool displayPresentation) {
    if (canvas == nullptr || viewportWidth <= 0 || viewportHeight <= 0) {
      return;
    }

    processBenchmarkTaps();
    bool interactiveDragActive = false;
    {
      std::lock_guard<std::mutex> lock(_mutex);
      interactiveDragActive =
          std::any_of(_turns.begin(), _turns.end(), [](const Turn &turn) {
            return turn.interactive && !turn.settling && !turn.completed;
          });
    }
    // Stock uploads allocate and flush full-page GPU render targets. Doing
    // that while the finger is down can block both this SurfaceView and
    // Android HWUI behind the same EGL driver. Protect drag frames, then
    // replenish during the released settlement so a rapid next fling has a
    // warm edge.
    if (!interactiveDragActive) {
      prepareStockTextures(directContext);
    }
    const double nowSteadyMs = steadyNowMs();
    const double nowEpochMs = epochNowMs();
    std::vector<RenderTurn> renderTurns;
    RestingFrame resting;

    {
      std::lock_guard<std::mutex> lock(_mutex);
      renderTurns.reserve(_turns.size());
      for (auto &turn : _turns) {
        if (turn.completed) {
          continue;
        }
        if (!turn.facesBound) {
          bindPresentedTurnFacesLocked(turn, nowEpochMs);
          if (turn.completed) {
            continue;
          }
        }
        if (!turn.started && turn.facesBound &&
            nowSteadyMs >= turn.notBeforeSteadyMs) {
          turn.started = true;
          turn.startedAtSteadyMs = nowSteadyMs;
        }
        if (!turn.started) {
          continue;
        }

        const MotionSample sample = sampleMotion(
            turn, !turn.interactive && !turn.firstFramePresented
                      ? turn.startedAtSteadyMs
                      : nowSteadyMs);
        if (sample.completed) {
          finishTurnLocked(turn, nowEpochMs);
          continue;
        }
        RenderTurn renderTurn = {
            turn.frontImage,
            turn.backImage,
            turn.backgroundLeftImage,
            turn.backgroundRightImage,
            turn.ownsBackground,
            turn.logicalPageRevision,
            turn.direction,
            turn.spread,
            turn.paperColor,
            {},
            0,
            0,
            0,
            0,
            0,
        };
        renderTurn.visualKind = turn.visualKind;
        renderTurn.lifecycleProgress = sample.lifecycleProgress;
        renderTurn.fixedChromeTop = turn.fixedChromeTop;
        renderTurn.fixedChromeBottom = turn.fixedChromeBottom;
        renderTurn.useTargetChrome =
            !turn.interactive || (turn.settling && turn.commitOnComplete);
        if (turn.visualKind == VisualKind::Curl) {
          buildRenderProfileLocked(
              turn, sample.shape, sample.lifecycleProgress,
              nowSteadyMs, renderTurn);
        }
        renderTurn.sourceChromePicture = turn.sourceChromePicture;
        renderTurn.targetChromePicture = turn.targetChromePicture;
        renderTurn.pixelWidth = turn.pixelWidth;
        renderTurn.pixelHeight = turn.pixelHeight;
        renderTurns.push_back(std::move(renderTurn));
        if (displayPresentation && !turn.interactive &&
            !turn.firstFramePresented && !turn.firstFrameQueued) {
          turn.firstFrameQueued = true;
          _pendingPresentedTurnIds.push_back(turn.id);
        }
      }

      // A later, faster turn can finish in the same draw pass after an older
      // slow turn has already emitted its render snapshot. Once that newer
      // logical page is complete, the cached older snapshot must never cover
      // it, even though the older motion continues off-screen for lifecycle
      // and resource cleanup.
      renderTurns.erase(
          std::remove_if(
              renderTurns.begin(), renderTurns.end(),
              [this](const RenderTurn &turn) {
                return turn.logicalPageRevision > 0 &&
                       turn.logicalPageRevision <
                           _latestCompletedPageRevision;
              }),
          renderTurns.end());

      _turns.erase(
          std::remove_if(_turns.begin(), _turns.end(),
                         [](const Turn &turn) { return turn.completed; }),
          _turns.end());
      if (activeGestureLocked() == _turns.end() &&
          !_pendingDirectInputs.empty()) {
        drainPendingDirectInputsLocked(nowSteadyMs, nowEpochMs);
      }
      resting = restingFrameLocked();
    }

    if (renderTurns.empty()) {
      drawResting(canvas, viewportWidth, viewportHeight, resting);
      return;
    }

    SkPaint paperPaint;
    paperPaint.setColor(renderTurns.back().paperColor);
    canvas->drawRect(SkRect::MakeWH(viewportWidth, viewportHeight),
                     paperPaint);
    const int direction = renderTurns.front().direction;
    if (renderTurns.front().visualKind == VisualKind::Slide) {
      drawSlideTurns(canvas, viewportWidth, viewportHeight, renderTurns);
    } else if (renderTurns.front().spread) {
      drawSpreadBackground(canvas, viewportWidth, viewportHeight,
                           renderTurns, direction);
      const int landingFace = direction > 0 ? -1 : 1;
      for (const auto &turn : renderTurns) {
        drawTurn(canvas, viewportWidth, viewportHeight, turn,
                 landingFace, false);
      }
      const int sourceFace = direction > 0 ? 1 : -1;
      for (auto iterator = renderTurns.rbegin();
           iterator != renderTurns.rend(); ++iterator) {
        drawTurn(canvas, viewportWidth, viewportHeight, *iterator,
                 sourceFace, true);
      }
    } else {
      const RenderTurn *background = nullptr;
      if (direction > 0) {
        const auto newestTarget = std::find_if(
            renderTurns.rbegin(), renderTurns.rend(),
            [](const RenderTurn &turn) {
              return turn.backgroundLeftImage != nullptr;
            });
        if (newestTarget != renderTurns.rend()) {
          background = &*newestTarget;
        }
      } else {
        const auto oldestSource = std::find_if(
            renderTurns.begin(), renderTurns.end(),
            [](const RenderTurn &turn) {
              return turn.backgroundLeftImage != nullptr;
            });
        if (oldestSource != renderTurns.end()) {
          background = &*oldestSource;
        }
      }
      if (background != nullptr) {
        drawBackgroundPage(canvas, 0, viewportWidth, viewportHeight,
                           background->backgroundLeftImage);
      }
      if (direction > 0) {
        for (auto iterator = renderTurns.rbegin();
             iterator != renderTurns.rend(); ++iterator) {
          drawTurn(canvas, viewportWidth, viewportHeight, *iterator);
        }
      } else {
        for (const auto &turn : renderTurns) {
          drawTurn(canvas, viewportWidth, viewportHeight, turn);
        }
      }
    }
  }

private:
  // Keep edge-on texture bands below roughly seven source pixels on a
  // 1680-wide page. The extra vertices are cheap on the native render thread
  // and avoid sending an entire glyph slice through one near-zero-width quad.
  static constexpr int kProfilePointCount = 257;
  // JS publishes a radius-ten bidirectional graph: 20 directed segments with
  // their reverse edges, for 40 entries total. Retaining older graph windows
  // only leaves edges whose page material can no longer fit in the bounded
  // picture table.
  static constexpr size_t kMaximumStockCount = 40;
  static constexpr size_t kMaximumPendingDirectInputCount = 64;
  static constexpr uint8_t kMaximumPageTextureUploadFailureCount = 3;
  // Each retained edge names at most six capture identities: its two whole
  // pages and, for a curling spread, four half pages. Decoration and slot
  // identity mean rolling spread windows cannot safely be reduced to a count
  // of physical pages. Bound the CPU display-list table by the actual
  // StockEntry contract; GPU textures remain governed by the much smaller
  // count and byte caps below.
  static constexpr size_t kMaximumRetainedPagePictureCount =
      kMaximumStockCount * 6;
  // Four preferred-direction pages plus a three-page reversal runway are
  // enough for the dedicated render thread to refill at 10 turns/second.
  // The count remains a safety ceiling for spread mode; the byte ceiling is
  // authoritative so a single-column page cannot consume twice the budget.
  static constexpr size_t kMaximumPreparedPageCount = 8;
  static constexpr size_t kMaximumPreparedPageBytes =
      72 * 1024 * 1024;
  static constexpr double kMinimumDurationMs = 16.0;
  static constexpr double kDefaultDurationMs = 260.0;
  static constexpr double kMaximumDurationMs = 240000.0;
  static constexpr float kPi = 3.14159265358979323846f;
  static constexpr float kMinimumPressedEdgeX = 0.14f;
  static constexpr float kMaximumProfileBendAmplitude =
      2.147033481101353f;
  static constexpr float kPressedSurfaceClearance = 0.015f;
  static constexpr float kMaximumPressedRollTilt =
      kPi - kMaximumProfileBendAmplitude - kPressedSurfaceClearance;
  static constexpr float kPressedHingeTiltDistance =
      0.3565937167398107f;
  static constexpr float kSlowCommitEdgeX =
      kMinimumPressedEdgeX - kPressedHingeTiltDistance;
  static constexpr float kGestureLiftStartX = 0.36f;
  static constexpr float kGestureRollTiltRate = 0.4f;
  static constexpr float kGestureHingeRotation =
      kMaximumPressedRollTilt * kGestureRollTiltRate;
  static constexpr float kGestureHingeChordX =
      0.15148003824552042f;
  static constexpr float kGestureHingeBendAmplitude =
      2.1266855842119465f;
  static constexpr float kFullGestureStartMinimumX = 0.25f;
  static constexpr float kWeakGripMaximumCompression = 0.04f;
  static constexpr float kWeakGripCompressionPerPage = 0.2f;
  static constexpr float kAutomaticPressDurationSeconds = 0.12f;
  static constexpr float kIncomingSettleDurationSeconds = 0.52f;
  static constexpr float kPropagationSpeedScale = 1.15f;
  static constexpr float kIncomingPageLandingStartProgress = 0.3f;
  static constexpr float kIncomingPagePreludeProgress = 0.28f;
  static constexpr float kMinimumRevertInitialSpeed = 0.65f;
  static constexpr float kMaximumRevertInitialSpeed = 6.3f;
  static constexpr float kRevertEaseOutInitialSlope = 3.0f;

  enum class MotionPhase {
    Automatic,
    GestureDrag,
    GestureTurn,
    GestureSettle,
    GestureRevert,
  };

  struct ProfileShape {
    float rotation = 0;
    float bendAmplitude = 0;
    float curvatureUniformity = 0;
    float landedLength = 0;
  };

  struct MotionSample {
    ProfileShape shape;
    float lifecycleProgress = 0;
    bool completed = false;
  };

  struct PhysicalPoint {
    float x = 0;
    float depth = 0;
    float normalX = 0;
    float normalZ = 1;
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

  struct StockEntry {
    std::string id;
    std::string fromPageKey;
    std::string toPageKey;
    // Picture ownership belongs to the bounded page-texture table. Keeping
    // another sk_sp per graph edge lets a rolling runway retain gigabytes.
    std::string sourceTextureKey;
    std::string targetTextureKey;
    TurnFaces faces;
    int pixelWidth = 0;
    int pixelHeight = 0;
    int direction = 1;
    bool spread = false;
    double durationMs = kDefaultDurationMs;
    double rapidDurationMs = kDefaultDurationMs;
    double launchIntervalMs = 100;
    SkColor paperColor = SK_ColorWHITE;
    uint64_t lastUsed = 0;
    sk_sp<SkPicture> sourceChromePicture;
    sk_sp<SkPicture> targetChromePicture;
  };

  struct PendingDirectInput {
    int direction;
  };

  struct PageTexture {
    std::string pageKey;
    sk_sp<SkPicture> picture;
    sk_sp<SkImage> image;
    int pixelWidth;
    int pixelHeight;
    uint64_t lastUsed;
    bool uploadPending = false;
    uint8_t uploadFailureCount = 0;
  };

  struct PendingPageTexture {
    std::string pageKey;
    sk_sp<SkPicture> picture;
    int pixelWidth;
    int pixelHeight;
  };

  struct Segment {
    std::array<SkPoint, 4> positions;
    std::array<SkPoint, 4> textureCoordinates;
    std::array<SkColor, 4> colors;
    float depth;
    bool frontFacing;
  };

  static double steadyNowMs() {
    return std::chrono::duration<double, std::milli>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
  }

  static double epochNowMs() {
    return std::chrono::duration<double, std::milli>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
  }

  static std::string pageTextureKey(uint64_t contentRevision,
                                    const std::string &pageKey) {
    return std::to_string(contentRevision) + "@" + pageKey;
  }

  static MotionTuning clampMotionTuning(MotionTuning tuning) {
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

  static PlanarMotionTuning clampPlanarMotionTuning(
      PlanarMotionTuning tuning) {
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

  static float bendAmplitudeForChord(float chord) {
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

  static float pressedRollCompleteness(float edgeX) {
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

  static float turnLandingStart(float rootTangent) {
    const float swing =
        std::clamp((kPi - rootTangent) / kPi, 0.0f, 1.0f);
    return swing / (swing + 1.0f);
  }

  static ProfileShape pressedShape(float edgeX, float rotation) {
    return {
        std::clamp(rotation, 0.0f, kMaximumPressedRollTilt),
        bendAmplitudeForChord(
            std::clamp(edgeX, kMinimumPressedEdgeX, 1.0f)),
        0,
        0,
    };
  }

  static ProfileShape turnShape(float progress, float startX,
                                float startRotation,
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

  static float gestureLiftRotationForFingerX(float fingerX) {
    if (fingerX <= kMinimumPressedEdgeX) {
      return kGestureHingeRotation;
    }
    const float progress = std::clamp(
        (kGestureLiftStartX - fingerX) /
            (kGestureLiftStartX - kMinimumPressedEdgeX),
        0.0f, 1.0f);
    return kGestureHingeRotation * progress;
  }

  static float gesturePressedChordForFingerX(float fingerX,
                                              float rotation) {
    if (fingerX <= kMinimumPressedEdgeX) {
      return kGestureHingeChordX;
    }
    const float targetEdge =
        std::clamp(fingerX, kMinimumPressedEdgeX, 1.0f);
    return std::clamp(
        targetEdge / std::max(0.000001f, std::cos(rotation)),
        kMinimumPressedEdgeX, 1.0f);
  }

  static float postHingeTurnProgress(float fingerX, float startBookX,
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

  static void updateGestureStateLocked(Turn &turn, float fingerX,
                                       float turnProgress) {
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

  static float incomingPageDragProgress(float progress,
                                        const MotionTuning &tuning) {
    return std::clamp(
        std::pow(std::clamp(progress, 0.0f, 1.0f),
                 tuning.incomingDragProgressExponent) *
            tuning.incomingDragProgressScale,
        0.0f, 1.0f);
  }

  static float incomingPageShapeProgress(float progress,
                                         const MotionTuning &tuning) {
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

  static float incomingPageRevealProgress(float progress,
                                          const MotionTuning &tuning) {
    return std::clamp(
        (std::clamp(progress, 0.0f, 1.0f) -
         tuning.incomingRevealStartProgress) /
            std::max(0.000001f,
                     tuning.incomingRevealEndProgress -
                         tuning.incomingRevealStartProgress),
        0.0f, 1.0f);
  }

  static float incomingPageRemainingDurationMs(
      float progress, const MotionTuning &tuning) {
    return 1000.0f * tuning.incomingSettleDurationSeconds *
           (1.0f - std::clamp(progress, 0.0f, 1.0f)) /
           std::max(0.000001f, 1.0f - tuning.incomingRevealEndProgress);
  }

  static float incomingPageDrivenProgress(float startProgress,
                                          float segmentProgress,
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

  static float automaticProgressForTurn(const Turn &turn,
                                        double nowSteadyMs) {
    const double elapsed =
        std::max(0.0, nowSteadyMs - turn.startedAtSteadyMs);
    const float remainingProgress =
        static_cast<float>(elapsed / std::max(1.0, turn.durationMs));
    return std::clamp(
        turn.baseProgress +
            (1.0f - turn.baseProgress) * remainingProgress,
        0.0f, 1.0f);
  }

  static float slideEasedProgress(float timeline, float easeOutBlend) {
    const float time = std::clamp(timeline, 0.0f, 1.0f);
    const float easeInOutQuad =
        time < 0.5f ? 2.0f * time * time
                    : 1.0f - 2.0f * (1.0f - time) * (1.0f - time);
    const float easeOutCubic =
        1.0f - std::pow(1.0f - time, 3.0f);
    const float blend = std::clamp(easeOutBlend, 0.0f, 1.0f);
    return easeInOutQuad * (1.0f - blend) + easeOutCubic * blend;
  }

  static MotionSample sampleMotion(const Turn &turn, double nowSteadyMs) {
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

  std::vector<Turn>::iterator activeGestureLocked() {
    return std::find_if(
        _turns.begin(), _turns.end(), [](const Turn &turn) {
          return turn.interactive && !turn.settling && !turn.completed;
        });
  }

  void advanceCurrentPageLocked(const std::string &pageKey) {
    _currentPageKey = pageKey;
    _currentPageRevision += 1;
  }

  /** The composer moved on by itself; the runtime presents this page later. */
  void leadToPageLocked(const std::string &pageKey) {
    advanceCurrentPageLocked(pageKey);
    _trail.push_back(pageKey);
    if (_trail.size() > kMaximumStockCount) {
      _trail.erase(_trail.begin());
    }
  }

  void consumeGestureLocked(Turn &turn, double nowEpochMs) {
    leadToPageLocked(turn.toPageKey);
    turn.logicalPageRevision = _currentPageRevision;
    _preferredDirection = turn.direction;
    _events.push_back(
        {turn.id, "consumed", nowEpochMs, turn.direction});
  }

  void releaseGestureLocked(Turn &turn, bool commit, float throwVelocity,
                            float minimumSpeedScale,
                            float maximumSpeedScale, float velocityGain,
                            float pageWidth, double nowSteadyMs,
                            double nowEpochMs) {
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

  static float profileTangentAngle(float material,
                                   const ProfileShape &shape) {
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

  static float smoothstep(float minimum, float maximum, float value) {
    const float progress =
        std::clamp((value - minimum) / (maximum - minimum), 0.0f, 1.0f);
    return progress * progress * (3.0f - 2.0f * progress);
  }

  static void buildPhysicalProfile(
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

  static void buildRenderProfileLocked(
      Turn &turn, const ProfileShape &shape, float lifecycleProgress,
      double nowSteadyMs, RenderTurn &renderTurn) {
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

  static bool facesReference(const TurnFaces &faces,
                             const std::string &pageKey) {
    return faces.front == pageKey || faces.back == pageKey ||
           faces.backgroundLeft == pageKey ||
           faces.backgroundRight == pageKey;
  }

  static bool stockReferencesPageTextureLocked(
      const StockEntry &entry, const std::string &pageKey) {
    return !pageKey.empty() &&
           (entry.sourceTextureKey == pageKey ||
            entry.targetTextureKey == pageKey ||
            facesReference(entry.faces, pageKey));
  }

  /**
   * Whether a page-table entry is still named by something that will draw it:
   * a stocked edge, a pending turn, or the page resting on screen.
   */
  bool pageTextureReferencedLocked(const std::string &pageKey) const {
    if (pageKey.empty()) {
      return false;
    }
    if (pageKey == _resting.textureKey || pageKey == _presented.textureKey) {
      return true;
    }
    const bool referencedByTurn = std::any_of(
        _turns.begin(), _turns.end(), [&pageKey](const Turn &turn) {
          return !turn.completed &&
                 (turn.target.textureKey == pageKey ||
                  (!turn.facesBound && facesReference(turn.faces, pageKey)));
        });
    return referencedByTurn ||
           std::any_of(_stock.begin(), _stock.end(),
                       [&pageKey](const StockEntry &entry) {
                         return stockReferencesPageTextureLocked(entry,
                                                                 pageKey);
                       });
  }

  PageTexture *pageTextureLocked(const std::string &pageKey) {
    const auto page = std::find_if(
        _pageTextures.begin(), _pageTextures.end(),
        [&pageKey](const PageTexture &entry) {
          return entry.pageKey == pageKey;
        });
    return page == _pageTextures.end() ? nullptr : &*page;
  }

  const PageTexture *pageTextureLocked(const std::string &pageKey) const {
    const auto page = std::find_if(
        _pageTextures.begin(), _pageTextures.end(),
        [&pageKey](const PageTexture &entry) {
          return entry.pageKey == pageKey;
        });
    return page == _pageTextures.end() ? nullptr : &*page;
  }

  /**
   * Keeps `picture` in the page table under `pageKey`. A StockEntry is an
   * addressable promise: as long as the edge survives, every SkPicture it
   * names must survive too. GPU images may be dropped and rebuilt, but
   * erasing a referenced entry leaves an edge that can never become drawable
   * again. `incomingPageKeys` are protected while their edge is assembled.
   */
  bool retainPageMaterialLocked(
      const std::string &pageKey, const sk_sp<SkPicture> &picture,
      int pixelWidth, int pixelHeight,
      const std::vector<std::string> &incomingPageKeys) {
    if (pageKey.empty()) {
      return true;
    }
    if (picture == nullptr) {
      return false;
    }
    if (auto *existing = pageTextureLocked(pageKey)) {
      existing->lastUsed = ++_pageTextureUsageCounter;
      if (existing->picture == nullptr && existing->image == nullptr) {
        existing->picture = picture;
        existing->pixelWidth = pixelWidth;
        existing->pixelHeight = pixelHeight;
        existing->uploadFailureCount = 0;
      }
      return true;
    }
    while (_pageTextures.size() >= kMaximumRetainedPagePictureCount) {
      auto oldest = _pageTextures.end();
      for (auto candidate = _pageTextures.begin();
           candidate != _pageTextures.end(); candidate += 1) {
        const bool incoming =
            std::find(incomingPageKeys.begin(), incomingPageKeys.end(),
                      candidate->pageKey) != incomingPageKeys.end();
        if (incoming || pageTextureReferencedLocked(candidate->pageKey)) {
          continue;
        }
        if (oldest == _pageTextures.end() ||
            (oldest->uploadPending && !candidate->uploadPending) ||
            (candidate->uploadPending == oldest->uploadPending &&
             candidate->lastUsed < oldest->lastUsed)) {
          oldest = candidate;
        }
      }
      if (oldest == _pageTextures.end()) {
        break;
      }
      _pageTextures.erase(oldest);
    }
    if (_pageTextures.size() >= kMaximumRetainedPagePictureCount) {
      return false;
    }
    _pageTextures.push_back(
        {pageKey, picture, nullptr, pixelWidth, pixelHeight,
         ++_pageTextureUsageCounter, false, 0});
    return true;
  }

  /**
   * One half of a spread, as its own picture: `right` selects the page right
   * of the spine. It replays the whole spread clipped, so recording costs only
   * a reference to the spread's display list.
   */
  static sk_sp<SkPicture> spreadHalfPicture(const sk_sp<SkPicture> &spread,
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

  static int halfPixelWidth(int pixelWidth) {
    return std::max(1, (pixelWidth + 1) / 2);
  }

  /** Retains one face's material under `key`, deriving a half page once. */
  bool retainFaceLocked(const std::string &key, const PageMaterial &page,
                        int half, const std::vector<std::string> &incoming) {
    if (half == 0) {
      return retainPageMaterialLocked(key, page.picture, page.pixelWidth,
                                      page.pixelHeight, incoming);
    }
    if (const auto *existing = pageTextureLocked(key);
        existing != nullptr &&
        (existing->picture != nullptr || existing->image != nullptr)) {
      return retainPageMaterialLocked(key, existing->picture,
                                      existing->pixelWidth,
                                      existing->pixelHeight, incoming);
    }
    return retainPageMaterialLocked(
        key,
        spreadHalfPicture(page.picture, page.pixelWidth, page.pixelHeight,
                          half > 0),
        halfPixelWidth(page.pixelWidth), page.pixelHeight, incoming);
  }

  /**
   * Retains both pages of a turn from `source` to `target` and derives the
   * faces it draws. False when the bounded page table cannot hold them.
   */
  bool retainTurnFacesLocked(const PageMaterial &source,
                             const PageMaterial &target, int direction,
                             TurnFaces &faces) {
    const PageMaterial &earlier = direction > 0 ? source : target;
    const PageMaterial &later = direction > 0 ? target : source;
    const bool halves = target.spread && _visualKind == VisualKind::Curl;
    faces = {};
    if (halves) {
      faces.front = earlier.textureKey + "#right";
      faces.back = later.textureKey + "#left";
      faces.backgroundLeft = earlier.textureKey + "#left";
      faces.backgroundRight = later.textureKey + "#right";
    } else {
      faces.front = earlier.textureKey;
      faces.backgroundLeft = later.textureKey;
      if (_visualKind == VisualKind::Curl && earlier.backPicture != nullptr) {
        faces.back = earlier.textureKey + "#back";
      }
    }
    const std::vector<std::string> incoming = {
        source.textureKey,    target.textureKey,       faces.front,
        faces.back,           faces.backgroundLeft,    faces.backgroundRight};
    if (!retainPageMaterialLocked(source.textureKey, source.picture,
                                  source.pixelWidth, source.pixelHeight,
                                  incoming) ||
        !retainPageMaterialLocked(target.textureKey, target.picture,
                                  target.pixelWidth, target.pixelHeight,
                                  incoming)) {
      return false;
    }
    if (!halves) {
      return faces.back.empty() ||
             retainPageMaterialLocked(faces.back, earlier.backPicture,
                                      earlier.pixelWidth, earlier.pixelHeight,
                                      incoming);
    }
    return retainFaceLocked(faces.front, earlier, 1, incoming) &&
           retainFaceLocked(faces.back, later, -1, incoming) &&
           retainFaceLocked(faces.backgroundLeft, earlier, -1, incoming) &&
           retainFaceLocked(faces.backgroundRight, later, 1, incoming);
  }

  /** The prepared image of every non-empty face; false while one is missing. */
  bool resolveFacesLocked(const TurnFaces &faces, Turn &turn) {
    const auto image = [this](const std::string &key, sk_sp<SkImage> &out) {
      if (key.empty()) {
        out = nullptr;
        return true;
      }
      out = preparedPageImageLocked(key);
      return out != nullptr;
    };
    sk_sp<SkImage> front;
    sk_sp<SkImage> back;
    sk_sp<SkImage> backgroundLeft;
    sk_sp<SkImage> backgroundRight;
    if (!image(faces.front, front) || !image(faces.back, back) ||
        !image(faces.backgroundLeft, backgroundLeft) ||
        !image(faces.backgroundRight, backgroundRight)) {
      return false;
    }
    turn.frontImage = std::move(front);
    turn.backImage = std::move(back);
    turn.backgroundLeftImage = std::move(backgroundLeft);
    turn.backgroundRightImage = std::move(backgroundRight);
    turn.facesBound = true;
    return true;
  }

  /** The page an edge lands on, to rest on screen once its turn ends. */
  PageMaterial stockTargetLocked(const StockEntry &stock) const {
    PageMaterial page;
    page.pageKey = stock.toPageKey;
    page.textureKey = stock.targetTextureKey;
    if (const auto *texture = pageTextureLocked(stock.targetTextureKey)) {
      page.picture = texture->picture;
    }
    page.chromePicture = stock.targetChromePicture;
    page.pixelWidth = stock.pixelWidth;
    page.pixelHeight = stock.pixelHeight;
    page.spread = stock.spread;
    page.paperColor = stock.paperColor;
    return page;
  }

  /** Fills a turn the composer takes from a stocked edge whose faces are ready. */
  void bindStockTurnLocked(Turn &turn, const StockEntry &stock) {
    turn.fromPageKey = stock.fromPageKey;
    turn.toPageKey = stock.toPageKey;
    turn.faces = stock.faces;
    resolveFacesLocked(stock.faces, turn);
    turn.target = stockTargetLocked(stock);
    turn.sourceChromePicture = stock.sourceChromePicture;
    turn.targetChromePicture = stock.targetChromePicture;
    turn.ownsBackground = true;
    turn.pixelWidth = stock.pixelWidth;
    turn.pixelHeight = stock.pixelHeight;
    turn.spread = stock.spread;
  }

  /**
   * Binds a presented turn once every face is uploaded. A face that keeps
   * failing to upload ends the turn on its target instead of spinning the
   * render thread forever.
   */
  void bindPresentedTurnFacesLocked(Turn &turn, double nowEpochMs) {
    if (resolveFacesLocked(turn.faces, turn)) {
      return;
    }
    for (const auto *key : {&turn.faces.front, &turn.faces.back,
                            &turn.faces.backgroundLeft,
                            &turn.faces.backgroundRight}) {
      const auto *page = key->empty() ? nullptr : pageTextureLocked(*key);
      if (key->empty() || (page != nullptr && page->image != nullptr)) {
        continue;
      }
      if (page == nullptr || page->picture == nullptr ||
          page->uploadFailureCount >= kMaximumPageTextureUploadFailureCount) {
        finishTurnLocked(turn, nowEpochMs);
        return;
      }
    }
  }

  /**
   * Ends a turn. A committed turn that is still the latest logical move lands:
   * its target becomes the resting page.
   */
  void finishTurnLocked(Turn &turn, double nowEpochMs) {
    if (turn.completed) {
      return;
    }
    turn.completed = true;
    if (!turn.id.empty()) {
      _events.push_back(
          {turn.id, turn.commitOnComplete ? "completed" : "cancelled",
           nowEpochMs, turn.direction});
    }
    if (!turn.commitOnComplete) {
      return;
    }
    _latestCompletedPageRevision =
        std::max(_latestCompletedPageRevision, turn.logicalPageRevision);
    if (turn.logicalPageRevision == _currentPageRevision &&
        turn.toPageKey == _currentPageKey && !turn.target.textureKey.empty()) {
      _resting = turn.target;
    }
  }

  /** Turns from the shown page to `page`, which becomes current right away. */
  void queuePresentedTurnLocked(PageMaterial page, int direction,
                                double durationMs, double launchIntervalMs,
                                double nowSteadyMs) {
    TurnFaces faces;
    if (!retainTurnFacesLocked(_presented, page, direction, faces)) {
      jumpLocked(std::move(page), epochNowMs());
      return;
    }
    Turn turn;
    turn.visualKind = _visualKind;
    turn.planarTuning = _planarMotionTuning;
    turn.fixedChromeTop = _fixedChromeTop;
    turn.fixedChromeBottom = _fixedChromeBottom;
    turn.id = "present:" + std::to_string(++_presentedTurnCounter);
    turn.fromPageKey = _presented.pageKey;
    turn.toPageKey = page.pageKey;
    turn.faces = std::move(faces);
    turn.sourceChromePicture = _presented.chromePicture;
    turn.targetChromePicture = page.chromePicture;
    turn.ownsBackground = true;
    turn.pixelWidth = page.pixelWidth;
    turn.pixelHeight = page.pixelHeight;
    turn.direction = direction;
    turn.spread = page.spread;
    turn.tuning = direction == 1 ? _automaticForwardTuning
                                 : _automaticBackwardTuning;
    const double cadenceMs = std::clamp(launchIntervalMs, 1.0, 1000.0);
    if (_turns.empty() && nowSteadyMs > _nextLaunchSteadyMs + cadenceMs) {
      _nextLaunchSteadyMs = nowSteadyMs;
    }
    turn.notBeforeSteadyMs = std::max(nowSteadyMs, _nextLaunchSteadyMs);
    _nextLaunchSteadyMs = turn.notBeforeSteadyMs + cadenceMs;
    turn.durationMs =
        std::clamp(durationMs, kMinimumDurationMs, kMaximumDurationMs);
    turn.paperColor = page.paperColor;
    turn.target = page;
    _preferredDirection = direction;
    advanceCurrentPageLocked(page.pageKey);
    turn.logicalPageRevision = _currentPageRevision;
    _presented = std::move(page);
    _turns.push_back(std::move(turn));
  }

  /** Shows `page` at once: every turn ends where it is and nothing leads. */
  void jumpLocked(PageMaterial page, double nowEpochMs) {
    for (auto &turn : _turns) {
      if (turn.completed) {
        continue;
      }
      turn.completed = true;
      if (!turn.id.empty()) {
        _events.push_back(
            {turn.id, turn.commitOnComplete ? "completed" : "cancelled",
             nowEpochMs, turn.direction});
      }
    }
    _turns.clear();
    _pendingPresentedTurnIds.clear();
    _pendingDirectInputs.clear();
    _trail.clear();
    advanceCurrentPageLocked(page.pageKey);
    _latestCompletedPageRevision = _currentPageRevision;
    _resting = page;
    _presented = std::move(page);
  }

  /** The resting page as draw() needs it, preferring the runtime's own paint. */
  RestingFrame restingFrameLocked() const {
    const PageMaterial &page =
        _presented.pageKey == _resting.pageKey &&
                !_presented.textureKey.empty()
            ? _presented
            : _resting;
    RestingFrame frame;
    frame.paperColor = page.paperColor;
    frame.pixelWidth = page.pixelWidth;
    frame.pixelHeight = page.pixelHeight;
    frame.chromePicture = page.chromePicture;
    frame.offset = _restingOffset;
    frame.revealColor = _revealColor;
    if (_restingOffset > 0 && page.pullPicture != nullptr) {
      frame.picture = page.pullPicture;
      return frame;
    }
    if (const auto *texture = pageTextureLocked(page.textureKey)) {
      frame.image = texture->image;
      frame.picture = texture->picture;
    }
    if (frame.picture == nullptr) {
      frame.picture = page.picture;
    }
    return frame;
  }

  static void drawResting(SkCanvas *canvas, float viewportWidth,
                          float viewportHeight, const RestingFrame &frame) {
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

  const StockEntry *stockEdgeLocked(const std::string &fromPageKey,
                                    int direction) const {
    const auto edge = std::find_if(
        _stock.begin(), _stock.end(),
        [&fromPageKey, direction](const StockEntry &entry) {
          return entry.fromPageKey == fromPageKey &&
                 entry.direction == direction;
        });
    return edge == _stock.end() ? nullptr : &*edge;
  }

  std::vector<std::pair<std::string, int>> stockPageDistancesLocked() const {
    std::vector<std::pair<std::string, int>> distances;
    if (_currentPageKey.empty()) {
      return distances;
    }
    distances.reserve(kMaximumStockCount + 1);
    distances.emplace_back(_currentPageKey, 0);
    for (size_t cursor = 0; cursor < distances.size(); cursor += 1) {
      const auto pageKey = distances[cursor].first;
      const int nextDistance = distances[cursor].second + 1;
      const auto append = [&distances, nextDistance](
                              const std::string &candidate) {
        if (candidate.empty() ||
            std::find_if(
                distances.begin(), distances.end(),
                [&candidate](const auto &entry) {
                  return entry.first == candidate;
                }) != distances.end()) {
          return;
        }
        distances.emplace_back(candidate, nextDistance);
      };
      for (const auto &edge : _stock) {
        if (edge.fromPageKey == pageKey) {
          append(edge.toPageKey);
        }
        if (edge.toPageKey == pageKey) {
          append(edge.fromPageKey);
        }
      }
    }
    return distances;
  }

  static int stockEntryDistanceLocked(
      const StockEntry &entry,
      const std::vector<std::pair<std::string, int>> &pageDistances) {
    int distance = static_cast<int>(kMaximumStockCount + 1);
    for (const auto &[pageKey, candidateDistance] : pageDistances) {
      if (pageKey == entry.fromPageKey || pageKey == entry.toPageKey) {
        distance = std::min(distance, candidateDistance);
      }
    }
    return distance;
  }

  std::vector<std::string> prioritizedPageKeysLocked() const {
    std::vector<std::string> keys;
    keys.reserve(kMaximumPreparedPageCount);
    size_t plannedBytes = 0;
    const auto append = [this, &keys, &plannedBytes](
                            const std::string &key) {
      if (key.empty() || keys.size() >= kMaximumPreparedPageCount ||
          std::find(keys.begin(), keys.end(), key) != keys.end()) {
        return;
      }
      const auto page = std::find_if(
          _pageTextures.begin(), _pageTextures.end(),
          [&key](const PageTexture &entry) {
            return entry.pageKey == key;
          });
      if (page == _pageTextures.end()) {
        return;
      }
      const size_t candidateBytes = estimatedPageTextureBytes(*page);
      const size_t byteBudget =
          std::max(kMaximumPreparedPageBytes, candidateBytes);
      if (!keys.empty() && plannedBytes + candidateBytes > byteBudget) {
        return;
      }
      keys.push_back(key);
      plannedBytes += candidateBytes;
    };
    const auto appendFaces = [&append](const TurnFaces &faces) {
      append(faces.front);
      append(faces.back);
      append(faces.backgroundLeft);
      append(faces.backgroundRight);
    };
    // What is on screen, then what a pending turn waits for, then the runway.
    append(_resting.textureKey);
    if (_presented.pageKey == _resting.pageKey) {
      append(_presented.textureKey);
    }
    for (const auto &turn : _turns) {
      if (!turn.completed && !turn.facesBound) {
        appendFaces(turn.faces);
      }
    }
    std::string preferredCursor = _currentPageKey;
    std::string reverseCursor = _currentPageKey;
    for (int depth = 0;
         depth < 8 && keys.size() < kMaximumPreparedPageCount; depth += 1) {
      if (!preferredCursor.empty()) {
        const auto *edge =
            stockEdgeLocked(preferredCursor, _preferredDirection);
        if (edge != nullptr) {
          appendFaces(edge->faces);
          preferredCursor = edge->toPageKey;
        } else {
          preferredCursor.clear();
        }
      }
      if (depth < 3 && !reverseCursor.empty() &&
          keys.size() < kMaximumPreparedPageCount) {
        const auto *edge =
            stockEdgeLocked(reverseCursor, -_preferredDirection);
        if (edge != nullptr) {
          appendFaces(edge->faces);
          reverseCursor = edge->toPageKey;
        } else {
          reverseCursor.clear();
        }
      }
    }
    return keys;
  }

  bool hasPendingPageTextureWorkLocked() const {
    for (const auto &pageKey : prioritizedPageKeysLocked()) {
      const auto page = std::find_if(
          _pageTextures.begin(), _pageTextures.end(),
          [&pageKey](const PageTexture &entry) {
            return entry.pageKey == pageKey;
          });
      if (page != _pageTextures.end() && page->image == nullptr &&
          page->picture != nullptr && !page->uploadPending &&
          page->uploadFailureCount <
              kMaximumPageTextureUploadFailureCount) {
        return true;
      }
    }
    return false;
  }

  sk_sp<SkImage> preparedPageImageLocked(const std::string &pageKey) {
    const auto page = std::find_if(
        _pageTextures.begin(), _pageTextures.end(),
        [&pageKey](const PageTexture &entry) {
          return entry.pageKey == pageKey;
        });
    if (page == _pageTextures.end() || page->image == nullptr) {
      return nullptr;
    }
    page->lastUsed = ++_pageTextureUsageCounter;
    return page->image;
  }

  sk_sp<SkPicture>
  retainedPagePictureLocked(const std::string &pageKey) const {
    if (pageKey.empty()) {
      return nullptr;
    }
    const auto page = std::find_if(
        _pageTextures.begin(), _pageTextures.end(),
        [&pageKey](const PageTexture &entry) {
          return entry.pageKey == pageKey;
        });
    return page == _pageTextures.end() ? nullptr : page->picture;
  }

  bool pageMaterialAvailableLocked(const std::string &pageKey) const {
    if (pageKey.empty()) {
      return true;
    }
    const auto page = std::find_if(
        _pageTextures.begin(), _pageTextures.end(),
        [&pageKey](const PageTexture &entry) {
          return entry.pageKey == pageKey;
        });
    return page != _pageTextures.end() &&
           (page->image != nullptr || page->picture != nullptr);
  }

  bool pageTextureReadyLocked(const std::string &pageKey) const {
    if (pageKey.empty()) {
      return true;
    }
    const auto page = std::find_if(
        _pageTextures.begin(), _pageTextures.end(),
        [&pageKey](const PageTexture &entry) {
          return entry.pageKey == pageKey;
        });
    return page != _pageTextures.end() && page->image != nullptr;
  }

  bool stockMaterialAvailableLocked(const StockEntry &entry) const {
    return pageMaterialAvailableLocked(entry.faces.front) &&
           pageMaterialAvailableLocked(entry.faces.back) &&
           pageMaterialAvailableLocked(entry.faces.backgroundLeft) &&
           pageMaterialAvailableLocked(entry.faces.backgroundRight);
  }

  bool stockTexturesReadyLocked(const StockEntry &entry) const {
    return pageTextureReadyLocked(entry.faces.front) &&
           pageTextureReadyLocked(entry.faces.back) &&
           pageTextureReadyLocked(entry.faces.backgroundLeft) &&
           pageTextureReadyLocked(entry.faces.backgroundRight);
  }

  void rearmPageTextureUploadLocked(const std::string &pageKey) {
    if (pageKey.empty()) {
      return;
    }
    const auto page = std::find_if(
        _pageTextures.begin(), _pageTextures.end(),
        [&pageKey](const PageTexture &entry) {
          return entry.pageKey == pageKey;
        });
    if (page == _pageTextures.end() || page->image != nullptr ||
        page->picture == nullptr || page->uploadPending ||
        page->uploadFailureCount <
            kMaximumPageTextureUploadFailureCount) {
      return;
    }
    // A transient RenderTarget allocation failure must not permanently poison
    // the exact page currently demanded by a held riffle. Give demand another
    // bounded retry window; if GPU pressure remains, the next cadence tick can
    // retry after older animated sheets have released their image references.
    page->uploadFailureCount = 0;
    page->lastUsed = ++_pageTextureUsageCounter;
  }

  void prioritizeRapidStockDemandLocked(const StockEntry &entry,
                                         int direction) {
    _preferredDirection = direction < 0 ? -1 : 1;
    rearmPageTextureUploadLocked(entry.faces.front);
    rearmPageTextureUploadLocked(entry.faces.back);
    rearmPageTextureUploadLocked(entry.faces.backgroundLeft);
    rearmPageTextureUploadLocked(entry.faces.backgroundRight);
  }

  static size_t estimatedPageTextureBytes(const PageTexture &page) {
    if (page.pixelWidth <= 0 || page.pixelHeight <= 0) {
      return 0;
    }
    return static_cast<size_t>(page.pixelWidth) *
           static_cast<size_t>(page.pixelHeight) * 4;
  }

  bool stockAvailableLocked(int direction) const {
    const int normalizedDirection = direction < 0 ? -1 : 1;
    return std::any_of(
        _stock.begin(), _stock.end(),
        [this, normalizedDirection](const StockEntry &entry) {
          return entry.fromPageKey == _currentPageKey &&
                 entry.direction == normalizedDirection;
        });
  }

  void emitStockMissLocked(int direction, double nowEpochMs,
                           const char *reason = "stock-miss") {
    _events.push_back(
        {std::string(reason) + ":" +
             std::to_string(++_stockMissCounter),
         "stock-miss", nowEpochMs, direction < 0 ? -1 : 1});
  }

  bool beginDirectionEpochLocked(int direction, double nowSteadyMs,
                                 double nowEpochMs) {
    const int normalizedDirection = direction < 0 ? -1 : 1;
    const bool reversing = std::any_of(
        _turns.begin(), _turns.end(),
        [normalizedDirection](const Turn &turn) {
          return !turn.completed && turn.direction != normalizedDirection;
        });
    if (!reversing) {
      return true;
    }

    // Declarative RN turns do not advance this compositor's addressable
    // anchor until React settles them. Refuse to cross that unresolved state;
    // the caller can use the existing RN fallback instead of starting from a
    // stale native page key.
    const bool hasUnaddressedTurn = std::any_of(
        _turns.begin(), _turns.end(), [](const Turn &turn) {
          return !turn.completed &&
                 (turn.fromPageKey.empty() || turn.toPageKey.empty());
        });
    if (hasUnaddressedTurn) {
      return false;
    }

    // The compositor's overlap ordering is intentionally one-directional.
    // When input reverses, the native logical anchor already represents every
    // consumed sheet, so waiting for the old visual tail would stall the new
    // direction and drawing both directions in one stack selects the wrong
    // background. Start a new visual epoch at that anchor: resolve the old
    // lifecycle records, discard their unpresented frames, and let the new
    // fully prepared sheet cover the declarative canvas from progress zero.
    for (const auto &turn : _turns) {
      if (turn.completed || turn.id.empty()) {
        continue;
      }
      _events.push_back(
          {turn.id, turn.commitOnComplete ? "completed" : "cancelled",
           nowEpochMs, turn.direction});
    }
    _turns.clear();
    _pendingPresentedTurnIds.clear();
    _pendingDirectInputs.erase(
        std::remove_if(
            _pendingDirectInputs.begin(), _pendingDirectInputs.end(),
            [normalizedDirection](const PendingDirectInput &pending) {
              return pending.direction != normalizedDirection;
            }),
        _pendingDirectInputs.end());
    _latestCompletedPageRevision = _currentPageRevision;
    _nextLaunchSteadyMs = nowSteadyMs;
    return true;
  }

  std::string nextStockTurnIdLocked(const std::string &stockId,
                                    bool rapidInput = false) {
    return stockId + "#turn:" +
           std::to_string(++_stockTurnCounter) +
           (rapidInput ? ":rapid" : "");
  }

  bool consumeStockLocked(int direction, double nowSteadyMs,
                          double nowEpochMs,
                          bool directInput = false,
                          bool emitStockMiss = true,
                          bool rapidInput = false) {
    const int normalizedDirection = direction < 0 ? -1 : 1;
    const auto stock = std::find_if(
        _stock.begin(), _stock.end(),
        [this, normalizedDirection](const StockEntry &entry) {
          return entry.fromPageKey == _currentPageKey &&
                 entry.direction == normalizedDirection;
        });
    if (stock == _stock.end()) {
      if (emitStockMiss) {
        emitStockMissLocked(normalizedDirection, nowEpochMs);
      }
      return false;
    }
    stock->lastUsed = ++_stockUsageCounter;
    if (rapidInput) {
      // Reversal demand can arrive before the reverse runway has reached the
      // GPU. Switch texture preparation immediately and recover exact-edge
      // uploads that exhausted their transient failure budget.
      prioritizeRapidStockDemandLocked(*stock, normalizedDirection);
    }
    // Native input may advance the logical anchor only when its complete first
    // frame is already drawable. A retained SkPicture is stock material, but
    // promoting it here can miss indefinitely; reject cold images so the
    // caller can use the existing RN fallback without swallowing the input.
    if (!stockTexturesReadyLocked(*stock)) {
      if (emitStockMiss) {
        emitStockMissLocked(normalizedDirection, nowEpochMs,
                            "stock-texture-miss");
      }
      return false;
    }
    if (!beginDirectionEpochLocked(
            normalizedDirection, nowSteadyMs, nowEpochMs)) {
      if (emitStockMiss) {
        emitStockMissLocked(normalizedDirection, nowEpochMs,
                            "direction-busy");
      }
      return false;
    }

    if (directInput) {
      // The tap lane deliberately has no launch queue. Preserve the original
      // overlap model by releasing every pending direct sheet immediately.
      for (auto &pending : _turns) {
        if (pending.directInput && !pending.interactive &&
            !pending.started && !pending.completed) {
          pending.notBeforeSteadyMs = nowSteadyMs;
        }
      }
    }
    Turn turn;
    turn.visualKind = _visualKind;
    turn.planarTuning = _planarMotionTuning;
    turn.fixedChromeTop = _fixedChromeTop;
    turn.fixedChromeBottom = _fixedChromeBottom;
    turn.id = nextStockTurnIdLocked(stock->id, rapidInput);
    bindStockTurnLocked(turn, *stock);
    turn.direction = normalizedDirection;
    turn.tuning = rapidInput
                      ? (turn.direction == 1 ? _rapidForwardTuning
                                             : _rapidBackwardTuning)
                      : (turn.direction == 1 ? _automaticForwardTuning
                                             : _automaticBackwardTuning);
    turn.directInput = directInput;
    if (directInput) {
      turn.notBeforeSteadyMs = nowSteadyMs;
    } else {
      if (_turns.empty() &&
          nowSteadyMs > _nextLaunchSteadyMs + stock->launchIntervalMs) {
        _nextLaunchSteadyMs = nowSteadyMs;
      }
      turn.notBeforeSteadyMs =
          std::max(nowSteadyMs, _nextLaunchSteadyMs);
      _nextLaunchSteadyMs =
          turn.notBeforeSteadyMs + stock->launchIntervalMs;
    }
    turn.durationMs =
        rapidInput ? stock->rapidDurationMs : stock->durationMs;
    turn.paperColor = stock->paperColor;
    _preferredDirection = normalizedDirection;
    leadToPageLocked(stock->toPageKey);
    turn.logicalPageRevision = _currentPageRevision;
    _events.push_back(
        {turn.id, "consumed", nowEpochMs, normalizedDirection});
    _turns.push_back(std::move(turn));
    return true;
  }

  void drainPendingDirectInputsLocked(double nowSteadyMs,
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

  void processBenchmarkTaps() {
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

  void prepareStockTextures(GrDirectContext *directContext) {
#if defined(SK_GRAPHITE)
    (void)directContext;
#else
    if (directContext == nullptr) {
      return;
    }
    PendingPageTexture candidate;
    size_t evictedTextureBytes = 0;
    {
      std::lock_guard<std::mutex> lock(_mutex);
      const auto prioritizedPageKeys = prioritizedPageKeysLocked();
      for (const auto &pageKey : prioritizedPageKeys) {
        const auto page = std::find_if(
            _pageTextures.begin(), _pageTextures.end(),
            [&pageKey](const PageTexture &entry) {
              return entry.pageKey == pageKey;
            });
        if (page == _pageTextures.end() || page->image != nullptr ||
            page->picture == nullptr || page->uploadPending ||
            page->uploadFailureCount >=
                kMaximumPageTextureUploadFailureCount) {
          continue;
        }
        page->uploadPending = true;
        page->lastUsed = ++_pageTextureUsageCounter;
        candidate = {page->pageKey, page->picture, page->pixelWidth,
                     page->pixelHeight};
        break;
      }
      if (candidate.picture != nullptr) {
        size_t preparedPageCount = 0;
        size_t preparedPageBytes = 0;
        for (const auto &page : _pageTextures) {
          if (page.image == nullptr) {
            continue;
          }
          preparedPageCount += 1;
          preparedPageBytes += estimatedPageTextureBytes(page);
        }
        const size_t candidateBytes =
            static_cast<size_t>(candidate.pixelWidth) *
            static_cast<size_t>(candidate.pixelHeight) * 4;
        const size_t byteBudget =
            std::max(kMaximumPreparedPageBytes, candidateBytes);
        while (preparedPageCount >= kMaximumPreparedPageCount ||
               preparedPageBytes + candidateBytes > byteBudget) {
          auto eviction = _pageTextures.end();
          size_t evictionPriority = 0;
          for (auto page = _pageTextures.begin();
               page != _pageTextures.end(); page += 1) {
            if (page->image == nullptr ||
                page->pageKey == candidate.pageKey) {
              continue;
            }
            const auto priority = std::find(
                prioritizedPageKeys.begin(), prioritizedPageKeys.end(),
                page->pageKey);
            const size_t priorityIndex =
                priority == prioritizedPageKeys.end()
                    ? prioritizedPageKeys.size() + 1
                    : static_cast<size_t>(
                          priority - prioritizedPageKeys.begin());
            if (eviction == _pageTextures.end() ||
                priorityIndex > evictionPriority ||
                (priorityIndex == evictionPriority &&
                 page->lastUsed < eviction->lastUsed)) {
              eviction = page;
              evictionPriority = priorityIndex;
            }
          }
          if (eviction == _pageTextures.end()) {
            break;
          }
          const size_t evictionBytes =
              estimatedPageTextureBytes(*eviction);
          eviction->image = nullptr;
          preparedPageCount -= 1;
          preparedPageBytes =
              preparedPageBytes > evictionBytes
                  ? preparedPageBytes - evictionBytes
                  : 0;
          evictedTextureBytes += evictionBytes;
        }
      }
    }
    if (evictedTextureBytes > 0) {
      // Released render targets otherwise sit in Ganesh's scratch cache and
      // each settled page can add another full-resolution allocation.
      directContext->purgeUnlockedResources(evictedTextureBytes, true);
    }
    if (candidate.picture == nullptr) {
      return;
    }

    sk_sp<SkImage> image;
    const auto imageInfo =
        SkImageInfo::MakeN32Premul(candidate.pixelWidth, candidate.pixelHeight);
    auto surface = SkSurfaces::RenderTarget(
        directContext, skgpu::Budgeted::kYes, imageInfo);
    if (surface != nullptr) {
      auto *pictureCanvas = surface->getCanvas();
      pictureCanvas->clear(SK_ColorTRANSPARENT);
      pictureCanvas->drawPicture(candidate.picture);
      image = surface->makeImageSnapshot();
      if (image != nullptr) {
        directContext->flushAndSubmit(image);
      }
    }

    std::lock_guard<std::mutex> lock(_mutex);
    const auto page = std::find_if(
        _pageTextures.begin(), _pageTextures.end(),
        [&candidate](const PageTexture &entry) {
          return entry.pageKey == candidate.pageKey;
        });
    if (page == _pageTextures.end()) {
      return;
    }
    page->uploadPending = false;
    if (image != nullptr) {
      page->image = std::move(image);
      page->lastUsed = ++_pageTextureUsageCounter;
      page->uploadFailureCount = 0;
    } else if (page->uploadFailureCount <
               kMaximumPageTextureUploadFailureCount) {
      page->uploadFailureCount += 1;
    }
#endif
  }

  static void drawBackgroundPage(SkCanvas *canvas, float destinationX,
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

  // Chrome contains only a few cached glyphs. Replaying it avoids allocating
  // and uploading two viewport-sized transparent textures per planar turn.
  static void drawChromePicture(SkCanvas *canvas, float viewportWidth,
                                float viewportHeight,
                                const sk_sp<SkPicture> &picture,
                                int pixelWidth, int pixelHeight) {
    if (picture == nullptr || pixelWidth <= 0 || pixelHeight <= 0) return;
    canvas->save();
    canvas->scale(viewportWidth / pixelWidth, viewportHeight / pixelHeight);
    canvas->drawPicture(picture);
    canvas->restore();
  }

  static void drawSpreadBackground(
      SkCanvas *canvas, float viewportWidth, float viewportHeight,
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

  static void drawShadow(SkCanvas *canvas, float viewportWidth,
                         float viewportHeight, float paperWidth, float spineX,
                         const RenderTurn &turn) {
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

  static void drawClippedPage(SkCanvas *canvas, float clipTop,
                              float clipBottom, float destinationX,
                              float viewportWidth, float viewportHeight,
                              const sk_sp<SkImage> &image) {
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

  static void drawSlideTurns(SkCanvas *canvas, float viewportWidth,
                             float viewportHeight,
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

  static void drawTurn(SkCanvas *canvas, float viewportWidth,
                       float viewportHeight, const RenderTurn &turn,
                       int faceFilter = 0, bool drawTurnShadow = true) {
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

  std::function<void()> _requestRedraw;
  mutable std::mutex _mutex;
  std::vector<Turn> _turns;
  std::vector<std::string> _pendingPresentedTurnIds;
  std::vector<Event> _events;
  std::vector<StockEntry> _stock;
  std::vector<PageTexture> _pageTextures;
  std::deque<PendingDirectInput> _pendingDirectInputs;
  /** The page the composer is on, including pages it turned to by itself. */
  std::string _currentPageKey;
  /** Pages the composer turned to ahead of the runtime, oldest first. */
  std::vector<std::string> _trail;
  /** The runtime's latest page, as last presented. */
  PageMaterial _presented;
  /** The page on screen at rest: the latest landed turn's target. */
  PageMaterial _resting;
  float _restingOffset = 0;
  SkColor _revealColor = SK_ColorWHITE;
  uint64_t _currentPageRevision = 0;
  uint64_t _latestCompletedPageRevision = 0;
  uint64_t _stockUsageCounter = 0;
  uint64_t _stockMissCounter = 0;
  uint64_t _stockTurnCounter = 0;
  uint64_t _pageTextureUsageCounter = 0;
  uint64_t _presentedTurnCounter = 0;
  double _nextLaunchSteadyMs = 0;
  int _benchmarkRemaining = 0;
  int _benchmarkDirection = 1;
  int _preferredDirection = 1;
  double _benchmarkIntervalMs = 100;
  double _benchmarkNextSteadyMs = 0;
  bool _inputEnabled = false;
  VisualKind _visualKind = VisualKind::Curl;
  PlanarMotionTuning _planarMotionTuning;
  float _fixedChromeTop = 0;
  float _fixedChromeBottom = 0;
  MotionTuning _automaticForwardTuning = {0.72f, 1.5f, 2.2f, 6.75f};
  MotionTuning _automaticBackwardTuning = {0.72f, 1.5f, 2.2f, 6.75f};
  MotionTuning _rapidForwardTuning = {0.72f, 1.5f, 2.2f, 6.75f};
  MotionTuning _rapidBackwardTuning = {0.72f, 1.5f, 2.2f, 6.75f};
  MotionTuning _gestureForwardTuning = {0.72f, 1.35f, 2.0f, 7.0f};
  MotionTuning _gestureBackwardTuning = {0.72f, 1.35f, 2.0f, 7.0f};
};

} // namespace lunar::reader
