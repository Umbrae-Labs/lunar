// The scrolling strip shown in place of the resting page and its turns.

#include "PagerCompositor.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace lunar::reader {

void PagerCompositor::setStrip(std::vector<StripWindow> windows) {
  // Band pictures only reference the window's display list; they are
  // recorded outside the lock.
  std::vector<StripEntry> entries;
  entries.reserve(windows.size());
  for (auto &window : windows) {
    if (window.page.textureKey.empty() || window.page.picture == nullptr ||
        window.length <= 0 || window.page.pixelWidth <= 0 ||
        window.page.pixelHeight <= 0) {
      continue;
    }
    StripEntry entry;
    entry.top = window.top;
    entry.length = window.length;
    entry.pixelWidth = window.page.pixelWidth;
    entry.pixelHeight = window.page.pixelHeight;
    entry.paperColor = window.page.paperColor;
    const int bandHeight =
        (entry.pixelHeight + kStripBandCount - 1) / kStripBandCount;
    for (int pixelTop = 0; pixelTop < entry.pixelHeight;
         pixelTop += bandHeight) {
      StripBand band;
      band.pixelTop = pixelTop;
      band.pixelHeight = std::min(bandHeight, entry.pixelHeight - pixelTop);
      band.textureKey =
          window.page.textureKey + "#band" + std::to_string(pixelTop);
      band.picture = stripBandPicture(window.page.picture, entry.pixelWidth,
                                      band.pixelTop, band.pixelHeight);
      entry.bands.push_back(std::move(band));
    }
    entries.push_back(std::move(entry));
  }
  {
    std::lock_guard<std::mutex> lock(_mutex);
    const bool active = !windows.empty();
    std::vector<std::string> incoming;
    for (const auto &entry : entries) {
      for (const auto &band : entry.bands) {
        incoming.push_back(band.textureKey);
      }
    }
    for (auto &entry : entries) {
      std::vector<StripBand> kept;
      kept.reserve(entry.bands.size());
      for (auto &band : entry.bands) {
        if (retainPageMaterialLocked(band.textureKey, band.picture,
                                     entry.pixelWidth, band.pixelHeight,
                                     incoming)) {
          kept.push_back(std::move(band));
        }
      }
      entry.bands = std::move(kept);
    }
    _strip = std::move(entries);
    _stripActive = active;
  }
  _requestRedraw();
}

void PagerCompositor::setStripOffset(float offset) {
  {
    std::lock_guard<std::mutex> lock(_mutex);
    if (offset == _stripOffset) {
      return;
    }
    _stripOffset = offset;
  }
  _requestRedraw();
}

bool PagerCompositor::drawStrip(SkCanvas *canvas, float viewportWidth,
                                float viewportHeight,
                                GrDirectContext *directContext) {
  struct VisibleBand {
    sk_sp<SkImage> image;
    sk_sp<SkPicture> picture;
    int pixelWidth = 0;
    int pixelHeight = 0;
    float y = 0;
    float height = 0;
  };
  struct VisibleWindow {
    float y = 0;
    float length = 0;
    std::vector<VisibleBand> bands;
  };
  {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_stripActive) {
      return false;
    }
    _stripViewportHeight = viewportHeight;
  }
  prepareStockTextures(directContext);
  // Windows sit on whole device pixels, so a texture recorded at the
  // device's density lands on them one to one.
  const SkMatrix matrix = canvas->getTotalMatrix();
  const float density = matrix.getScaleY() > 0 ? matrix.getScaleY() : 1.0f;
  const auto snap = [density](float value) {
    return std::round(value * density) / density;
  };
  std::vector<VisibleWindow> visible;
  SkColor paperColor = SK_ColorWHITE;
  bool oneToOne = true;
  {
    std::lock_guard<std::mutex> lock(_mutex);
    if (!_strip.empty()) {
      paperColor = _strip.front().paperColor;
    }
    for (const auto &entry : _strip) {
      const float y = snap(entry.top - _stripOffset);
      if (y + entry.length <= 0 || y >= viewportHeight) {
        continue;
      }
      const float unitY =
          viewportHeight / static_cast<float>(entry.pixelHeight);
      oneToOne =
          oneToOne &&
          std::abs(std::round(viewportWidth * density) - entry.pixelWidth) <=
              1.0f &&
          std::abs(std::round(viewportHeight * density) -
                   entry.pixelHeight) <= 1.0f;
      VisibleWindow window;
      window.y = y;
      window.length = entry.length;
      for (const auto &band : entry.bands) {
        const float bandY = y + static_cast<float>(band.pixelTop) * unitY;
        const float height = static_cast<float>(band.pixelHeight) * unitY;
        if (bandY + height <= std::max(0.0f, y) ||
            bandY >= std::min(viewportHeight, y + entry.length)) {
          continue;
        }
        VisibleBand visibleBand;
        visibleBand.image = preparedPageImageLocked(band.textureKey);
        if (visibleBand.image == nullptr) {
          visibleBand.picture = band.picture;
        }
        visibleBand.pixelWidth = entry.pixelWidth;
        visibleBand.pixelHeight = band.pixelHeight;
        visibleBand.y = bandY;
        visibleBand.height = height;
        window.bands.push_back(std::move(visibleBand));
      }
      visible.push_back(std::move(window));
    }
  }
  SkPaint paper;
  paper.setColor(paperColor);
  canvas->drawRect(SkRect::MakeWH(viewportWidth, viewportHeight), paper);
  // One to one, nearest sampling copies texels; otherwise linear keeps the
  // per-frame cost of a moving full-screen image low.
  const SkSamplingOptions sampling(oneToOne ? SkFilterMode::kNearest
                                            : SkFilterMode::kLinear);
  for (const auto &window : visible) {
    canvas->save();
    canvas->clipRect(
        SkRect::MakeXYWH(0, window.y, viewportWidth, window.length));
    for (const auto &band : window.bands) {
      if (band.image != nullptr) {
        canvas->drawImageRect(
            band.image,
            SkRect::MakeIWH(band.image->width(), band.image->height()),
            SkRect::MakeXYWH(0, band.y, viewportWidth, band.height),
            sampling, nullptr, SkCanvas::kFast_SrcRectConstraint);
      } else if (band.picture != nullptr) {
        // Not uploaded yet: replay the band's display list directly.
        canvas->save();
        canvas->translate(0, band.y);
        canvas->scale(viewportWidth / static_cast<float>(band.pixelWidth),
                      band.height / static_cast<float>(band.pixelHeight));
        canvas->drawPicture(band.picture);
        canvas->restore();
      }
    }
    canvas->restore();
  }
  return true;
}

} // namespace lunar::reader
