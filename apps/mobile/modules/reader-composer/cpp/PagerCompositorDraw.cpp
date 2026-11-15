// Frames: what each draw puts on screen and when a turn's clock starts.

#include "PagerCompositor.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace lunar::reader {

void PagerCompositor::commitPresentedFrame() {
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

bool PagerCompositor::hasActiveTurns() const {
  std::lock_guard<std::mutex> lock(_mutex);
  return !_turns.empty() || _benchmarkRemaining > 0 ||
         !_pendingDirectInputs.empty() ||
         hasPendingPageTextureWorkLocked();
}

void PagerCompositor::draw(SkCanvas *canvas, float viewportWidth,
                           float viewportHeight, GrDirectContext *directContext,
                           bool displayPresentation) {
  if (canvas == nullptr || viewportWidth <= 0 || viewportHeight <= 0) {
    return;
  }

  if (drawStrip(canvas, viewportWidth, viewportHeight, directContext)) {
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
        buildRenderProfile(
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

RestingFrame PagerCompositor::restingFrameLocked() const {
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

} // namespace lunar::reader
