// Presentation from the runtime and the lifecycle of every turn.

#include "PagerCompositor.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace lunar::reader {

void PagerCompositor::configureMotion(
    int visualKind, float fixedChromeTop, float fixedChromeBottom,
    MotionTuning automaticForward, MotionTuning automaticBackward,
    MotionTuning rapidForward, MotionTuning rapidBackward,
    MotionTuning gestureForward, MotionTuning gestureBackward,
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

void PagerCompositor::present(PageMaterial page, int transition,
                              double durationMs, double launchIntervalMs,
                              bool force) {
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

void PagerCompositor::setRestingOffset(float offset, SkColor revealColor) {
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

void PagerCompositor::reset() {
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
    _strip.clear();
    _stripActive = false;
    _stripOffset = 0;
  }
  _requestRedraw();
}

std::vector<Event> PagerCompositor::takeEvents() {
  std::vector<Event> events;
  {
    std::lock_guard<std::mutex> lock(_mutex);
    events.swap(_events);
  }
  return events;
}

void PagerCompositor::advanceCurrentPageLocked(const std::string &pageKey) {
  _currentPageKey = pageKey;
  _currentPageRevision += 1;
}

void PagerCompositor::leadToPageLocked(const std::string &pageKey) {
  advanceCurrentPageLocked(pageKey);
  _trail.push_back(pageKey);
  if (_trail.size() > kMaximumStockCount) {
    _trail.erase(_trail.begin());
  }
}

void PagerCompositor::bindPresentedTurnFacesLocked(Turn &turn,
                                                   double nowEpochMs) {
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

void PagerCompositor::finishTurnLocked(Turn &turn, double nowEpochMs) {
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

void PagerCompositor::queuePresentedTurnLocked(PageMaterial page, int direction,
                                               double durationMs,
                                               double launchIntervalMs,
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

void PagerCompositor::jumpLocked(PageMaterial page, double nowEpochMs) {
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

bool PagerCompositor::beginDirectionEpochLocked(int direction,
                                                double nowSteadyMs,
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

} // namespace lunar::reader
