#pragma once

#include <functional>
#include <memory>

#include "PagerCompositor.h"
#include "RNSkPictureExtension.h"

namespace lunar::reader {

/**
 * Attaches a page compositor to a Skia picture view. Every picture view gets
 * one; it stays idle, and draws nothing, until the reader stocks or enqueues
 * pages through `ReaderComposerApi`.
 */
class ReaderComposerExtension final : public RNSkia::RNSkPictureExtension {
public:
  explicit ReaderComposerExtension(std::function<void()> requestRedraw)
      : _compositor(std::move(requestRedraw)) {}

  void draw(SkCanvas *canvas, float width, float height,
            GrDirectContext *directContext) override {
    _compositor.draw(canvas, width, height, directContext, true);
  }

  bool needsContinuousRedraw() const override {
    return _compositor.hasActiveTurns();
  }

  void framePresented() override { _compositor.commitPresentedFrame(); }

  PagerCompositor &compositor() { return _compositor; }

private:
  PagerCompositor _compositor;
};

} // namespace lunar::reader
