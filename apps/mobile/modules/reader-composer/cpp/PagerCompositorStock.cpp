// The stock: edges between pages held ready for input, and the turns taken from
// them.

#include "PagerCompositor.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace lunar::reader {

void PagerCompositor::stockPicture(std::string id, PageMaterial source,
                                   PageMaterial target, int direction,
                                   double durationMs, double rapidDurationMs,
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

PageMaterial PagerCompositor::stockTargetLocked(const StockEntry &stock) const {
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

void PagerCompositor::bindStockTurnLocked(Turn &turn, const StockEntry &stock) {
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

const PagerCompositor::StockEntry *
PagerCompositor::stockEdgeLocked(const std::string &fromPageKey,
                                 int direction) const {
  const auto edge = std::find_if(
      _stock.begin(), _stock.end(),
      [&fromPageKey, direction](const StockEntry &entry) {
        return entry.fromPageKey == fromPageKey &&
               entry.direction == direction;
      });
  return edge == _stock.end() ? nullptr : &*edge;
}

std::vector<std::pair<std::string, int>>
PagerCompositor::stockPageDistancesLocked() const {
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

int PagerCompositor::stockEntryDistanceLocked(
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

bool PagerCompositor::stockMaterialAvailableLocked(
    const StockEntry &entry) const {
  return pageMaterialAvailableLocked(entry.faces.front) &&
         pageMaterialAvailableLocked(entry.faces.back) &&
         pageMaterialAvailableLocked(entry.faces.backgroundLeft) &&
         pageMaterialAvailableLocked(entry.faces.backgroundRight);
}

bool PagerCompositor::stockTexturesReadyLocked(const StockEntry &entry) const {
  return pageTextureReadyLocked(entry.faces.front) &&
         pageTextureReadyLocked(entry.faces.back) &&
         pageTextureReadyLocked(entry.faces.backgroundLeft) &&
         pageTextureReadyLocked(entry.faces.backgroundRight);
}

void PagerCompositor::prioritizeRapidStockDemandLocked(const StockEntry &entry,
                                                       int direction) {
  _preferredDirection = direction < 0 ? -1 : 1;
  rearmPageTextureUploadLocked(entry.faces.front);
  rearmPageTextureUploadLocked(entry.faces.back);
  rearmPageTextureUploadLocked(entry.faces.backgroundLeft);
  rearmPageTextureUploadLocked(entry.faces.backgroundRight);
}

bool PagerCompositor::stockAvailableLocked(int direction) const {
  const int normalizedDirection = direction < 0 ? -1 : 1;
  return std::any_of(
      _stock.begin(), _stock.end(),
      [this, normalizedDirection](const StockEntry &entry) {
        return entry.fromPageKey == _currentPageKey &&
               entry.direction == normalizedDirection;
      });
}

void PagerCompositor::emitStockMissLocked(int direction, double nowEpochMs,
                                          const char *reason) {
  _events.push_back(
      {std::string(reason) + ":" +
           std::to_string(++_stockMissCounter),
       "stock-miss", nowEpochMs, direction < 0 ? -1 : 1});
}

std::string PagerCompositor::nextStockTurnIdLocked(const std::string &stockId,
                                                   bool rapidInput) {
  return stockId + "#turn:" +
         std::to_string(++_stockTurnCounter) +
         (rapidInput ? ":rapid" : "");
}

bool PagerCompositor::consumeStockLocked(int direction, double nowSteadyMs,
                                         double nowEpochMs, bool directInput,
                                         bool emitStockMiss, bool rapidInput) {
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

} // namespace lunar::reader
