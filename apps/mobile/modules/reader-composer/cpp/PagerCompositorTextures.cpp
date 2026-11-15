// The bounded page table: retained pictures, turn faces, and their GPU uploads
// in priority order.

#include "PagerCompositor.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace lunar::reader {

namespace {

bool facesReference(const TurnFaces &faces, const std::string &pageKey) {
  return faces.front == pageKey || faces.back == pageKey ||
         faces.backgroundLeft == pageKey ||
         faces.backgroundRight == pageKey;
}

} // namespace

bool PagerCompositor::stockReferencesPageTextureLocked(
    const StockEntry &entry, const std::string &pageKey) {
  return !pageKey.empty() &&
         (entry.sourceTextureKey == pageKey ||
          entry.targetTextureKey == pageKey ||
          facesReference(entry.faces, pageKey));
}

bool PagerCompositor::pageTextureReferencedLocked(
    const std::string &pageKey) const {
  if (pageKey.empty()) {
    return false;
  }
  if (pageKey == _resting.textureKey || pageKey == _presented.textureKey) {
    return true;
  }
  for (const auto &entry : _strip) {
    if (std::any_of(entry.bands.begin(), entry.bands.end(),
                    [&pageKey](const StripBand &band) {
                      return band.textureKey == pageKey;
                    })) {
      return true;
    }
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

PagerCompositor::PageTexture *
PagerCompositor::pageTextureLocked(const std::string &pageKey) {
  const auto page = std::find_if(
      _pageTextures.begin(), _pageTextures.end(),
      [&pageKey](const PageTexture &entry) {
        return entry.pageKey == pageKey;
      });
  return page == _pageTextures.end() ? nullptr : &*page;
}

const PagerCompositor::PageTexture *
PagerCompositor::pageTextureLocked(const std::string &pageKey) const {
  const auto page = std::find_if(
      _pageTextures.begin(), _pageTextures.end(),
      [&pageKey](const PageTexture &entry) {
        return entry.pageKey == pageKey;
      });
  return page == _pageTextures.end() ? nullptr : &*page;
}

bool PagerCompositor::retainPageMaterialLocked(
    const std::string &pageKey, const sk_sp<SkPicture> &picture, int pixelWidth,
    int pixelHeight, const std::vector<std::string> &incomingPageKeys) {
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

size_t PagerCompositor::preparedPageCountLimitLocked() const {
  return _stripActive ? kMaximumPreparedStripBandCount
                      : kMaximumPreparedPageCount;
}

bool PagerCompositor::retainFaceLocked(
    const std::string &key, const PageMaterial &page, int half,
    const std::vector<std::string> &incoming) {
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

bool PagerCompositor::retainTurnFacesLocked(const PageMaterial &source,
                                            const PageMaterial &target,
                                            int direction, TurnFaces &faces) {
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

bool PagerCompositor::resolveFacesLocked(const TurnFaces &faces, Turn &turn) {
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

std::vector<std::string> PagerCompositor::prioritizedPageKeysLocked() const {
  std::vector<std::string> keys;
  const size_t limit = preparedPageCountLimitLocked();
  keys.reserve(limit);
  size_t plannedBytes = 0;
  const auto append = [this, &keys, &plannedBytes, limit](
                          const std::string &key) {
    if (key.empty() || keys.size() >= limit ||
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
  if (_stripActive) {
    // The bands the view shows, then those nearest it either way. Bands
    // past a window's content are never shown and never uploaded.
    const float viewTop = _stripOffset;
    const float viewBottom = _stripOffset + _stripViewportHeight;
    struct Candidate {
      const std::string *key;
      float distance;
    };
    std::vector<Candidate> ordered;
    for (const auto &entry : _strip) {
      const float unit = _stripViewportHeight > 0
                             ? _stripViewportHeight /
                                   static_cast<float>(entry.pixelHeight)
                             : 0.0f;
      for (const auto &band : entry.bands) {
        const float top =
            entry.top + static_cast<float>(band.pixelTop) * unit;
        const float bottom =
            std::min(entry.top + entry.length,
                     top + static_cast<float>(band.pixelHeight) * unit);
        if (unit > 0 && top >= entry.top + entry.length) {
          continue;
        }
        const float distance = bottom <= viewTop  ? viewTop - bottom
                               : top >= viewBottom ? top - viewBottom
                                                   : 0.0f;
        ordered.push_back({&band.textureKey, distance});
      }
    }
    std::stable_sort(ordered.begin(), ordered.end(),
                     [](const Candidate &left, const Candidate &right) {
                       return left.distance < right.distance;
                     });
    for (const auto &candidate : ordered) {
      append(*candidate.key);
    }
    return keys;
  }
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

bool PagerCompositor::hasPendingPageTextureWorkLocked() const {
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

sk_sp<SkImage>
PagerCompositor::preparedPageImageLocked(const std::string &pageKey) {
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
PagerCompositor::retainedPagePictureLocked(const std::string &pageKey) const {
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

bool PagerCompositor::pageMaterialAvailableLocked(
    const std::string &pageKey) const {
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

bool PagerCompositor::pageTextureReadyLocked(const std::string &pageKey) const {
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

void PagerCompositor::rearmPageTextureUploadLocked(const std::string &pageKey) {
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

size_t PagerCompositor::estimatedPageTextureBytes(const PageTexture &page) {
  if (page.pixelWidth <= 0 || page.pixelHeight <= 0) {
    return 0;
  }
  return static_cast<size_t>(page.pixelWidth) *
         static_cast<size_t>(page.pixelHeight) * 4;
}

void PagerCompositor::prepareStockTextures(GrDirectContext *directContext) {
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
      while (preparedPageCount >= preparedPageCountLimitLocked() ||
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

} // namespace lunar::reader
