// ReaderComposerApi: the JS surface of the reader's page compositor.
//
// Compiled into react-native-skia's library through its picture-extension hook
// (see ../README.md), so it shares Skia's build, render thread and GPU context.
// Installed as `global.ReaderComposerApi` beside `SkiaViewApi`; the UI runtime
// reaches the same host object through worklet capture.

#include <cstddef>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include <jsi/jsi.h>

#include "JsiHostObject.h"
// RNSkJsiViewApi.h uses JsiPromises without including it. Never include
// JsiSkApi.h here: several RN Skia API headers define non-inline functions,
// which RNSkManager.cpp already emits, and a second copy fails to link.
#include "JsiPromises.h"
#include "JsiSkPicture.h"
#include "RNSkJsiViewApi.h"
#include "RNSkPictureExtension.h"
#include "RNSkPictureView.h"
#include "RNSkPlatformContext.h"

#include "ReaderComposerExtension.h"

namespace lunar::reader {

namespace jsi = facebook::jsi;

using RNSkia::JsiSkPicture;
using RNSkia::RNSkPictureView;
using RNSkia::RNSkPlatformContext;
using RNSkia::RNSkViewInfo;
using RNSkia::ViewRegistry;

/** The protocol the TS adapter checks before it uses this API. */
constexpr int kReaderComposerProtocolVersion = 16;

class ReaderComposerApi final : public RNJsi::JsiHostObject {
public:
  explicit ReaderComposerApi(std::shared_ptr<RNSkPlatformContext> platformContext)
      : _platformContext(std::move(platformContext)) {}

  /** Reads a page object: see `PagerCompositor::PageMaterial`. */
  static bool pageFromValue(jsi::Runtime &runtime, const jsi::Value &value,
                            PagerCompositor::PageMaterial &page) {
    if (!value.isObject()) {
      return false;
    }
    const auto object = value.asObject(runtime);
    const auto string = [&runtime, &object](const char *name,
                                            std::string &out) {
      const auto field = object.getProperty(runtime, name);
      if (!field.isString()) {
        return false;
      }
      out = field.asString(runtime).utf8(runtime);
      return !out.empty();
    };
    const auto number = [&runtime, &object](const char *name, double &out) {
      const auto field = object.getProperty(runtime, name);
      if (!field.isNumber()) {
        return false;
      }
      out = field.asNumber();
      return true;
    };
    const auto picture = [&runtime, &object](const char *name,
                                             bool required) {
      const auto field = object.getProperty(runtime, name);
      if (!field.isObject()) {
        return std::pair<bool, sk_sp<SkPicture>>(!required && (field.isNull() || field.isUndefined()), nullptr);
      }
      return std::pair<bool, sk_sp<SkPicture>>(
          true, JsiSkPicture::fromValue(runtime, field));
    };
    double pixelWidth = 0;
    double pixelHeight = 0;
    double paperColor = 0;
    const auto [hasPicture, pagePicture] = picture("picture", true);
    const auto [validChrome, chromePicture] = picture("chromePicture", false);
    const auto [validPull, pullPicture] = picture("pullPicture", false);
    const auto [validBack, backPicture] = picture("backPicture", false);
    const auto spread = object.getProperty(runtime, "spread");
    if (!string("pageKey", page.pageKey) ||
        !string("textureKey", page.textureKey) || !hasPicture ||
        !validChrome || !validPull || !validBack ||
        !number("pixelWidth", pixelWidth) ||
        !number("pixelHeight", pixelHeight) ||
        !number("paperColor", paperColor) || !spread.isBool()) {
      return false;
    }
    page.picture = pagePicture;
    page.chromePicture = chromePicture;
    page.pullPicture = pullPicture;
    page.backPicture = backPicture;
    page.pixelWidth = static_cast<int>(pixelWidth);
    page.pixelHeight = static_cast<int>(pixelHeight);
    page.paperColor = static_cast<SkColor>(paperColor);
    page.spread = spread.getBool();
    return page.picture != nullptr && page.pixelWidth > 0 &&
           page.pixelHeight > 0;
  }

  JSI_HOST_FUNCTION(pagerPresent) {
    PagerCompositor::PageMaterial page;
    if (count != 6 || !arguments[0].isNumber() ||
        !pageFromValue(runtime, arguments[1], page) ||
        !arguments[2].isNumber() || !arguments[3].isNumber() ||
        !arguments[4].isNumber() || !arguments[5].isBool()) {
      _platformContext->raiseError(
          "pagerPresent: Expected a native id, a page, a transition, a "
          "duration, a launch interval and a force flag.");
      return jsi::Value::undefined();
    }
    auto composer = composerFor(static_cast<int>(arguments[0].asNumber()));
    if (composer == nullptr) {
      return jsi::Value(false);
    }
    composer->present(std::move(page),
                      static_cast<int>(arguments[2].asNumber()),
                      arguments[3].asNumber(), arguments[4].asNumber(),
                      arguments[5].getBool());
    return jsi::Value(true);
  }

  JSI_HOST_FUNCTION(pagerStockPicture) {
    PagerCompositor::PageMaterial source;
    PagerCompositor::PageMaterial target;
    if (count != 8 || !arguments[0].isNumber() || !arguments[1].isString() ||
        !pageFromValue(runtime, arguments[2], source) ||
        !pageFromValue(runtime, arguments[3], target) ||
        !arguments[4].isNumber() || !arguments[5].isNumber() ||
        !arguments[6].isNumber() || !arguments[7].isNumber()) {
      _platformContext->raiseError(
          "pagerStockPicture: Expected a native id, an id, a source page, a "
          "target page, a direction and three durations.");
      return jsi::Value::undefined();
    }
    auto composer = composerFor(static_cast<int>(arguments[0].asNumber()));
    if (composer == nullptr) {
      return jsi::Value(false);
    }
    composer->stockPicture(arguments[1].asString(runtime).utf8(runtime),
                           std::move(source), std::move(target),
                           static_cast<int>(arguments[4].asNumber()),
                           arguments[5].asNumber(), arguments[6].asNumber(),
                           arguments[7].asNumber());
    return jsi::Value(true);
  }

  JSI_HOST_FUNCTION(pagerSetRestingOffset) {
    if (count != 3 || !arguments[0].isNumber() || !arguments[1].isNumber() ||
        !arguments[2].isNumber()) {
      _platformContext->raiseError(
          "pagerSetRestingOffset: Expected a native id, an offset and a "
          "color.");
      return jsi::Value::undefined();
    }
    auto composer = composerFor(static_cast<int>(arguments[0].asNumber()));
    if (composer != nullptr) {
      composer->setRestingOffset(static_cast<float>(arguments[1].asNumber()),
                                 static_cast<SkColor>(arguments[2].asNumber()));
    }
    return jsi::Value::undefined();
  }

  JSI_HOST_FUNCTION(pagerSetStrip) {
    if (count != 2 || !arguments[0].isNumber() || !arguments[1].isObject() ||
        !arguments[1].asObject(runtime).isArray(runtime)) {
      _platformContext->raiseError(
          "pagerSetStrip: Expected a native id and an array of windows.");
      return jsi::Value::undefined();
    }
    const auto list = arguments[1].asObject(runtime).asArray(runtime);
    std::vector<PagerCompositor::StripWindow> windows;
    windows.reserve(list.size(runtime));
    for (size_t index = 0; index < list.size(runtime); index += 1) {
      const auto value = list.getValueAtIndex(runtime, index);
      if (!value.isObject()) {
        _platformContext->raiseError("pagerSetStrip: A window must be an object.");
        return jsi::Value::undefined();
      }
      const auto object = value.asObject(runtime);
      const auto top = object.getProperty(runtime, "top");
      const auto length = object.getProperty(runtime, "length");
      PagerCompositor::StripWindow window;
      if (!top.isNumber() || !length.isNumber() ||
          !pageFromValue(runtime, object.getProperty(runtime, "page"),
                         window.page)) {
        _platformContext->raiseError(
            "pagerSetStrip: A window needs a page, a top and a length.");
        return jsi::Value::undefined();
      }
      window.top = static_cast<float>(top.asNumber());
      window.length = static_cast<float>(length.asNumber());
      windows.push_back(std::move(window));
    }
    auto composer = composerFor(static_cast<int>(arguments[0].asNumber()));
    if (composer == nullptr) {
      return jsi::Value(false);
    }
    composer->setStrip(std::move(windows));
    return jsi::Value(true);
  }

  JSI_HOST_FUNCTION(pagerSetStripOffset) {
    if (count != 2 || !arguments[0].isNumber() || !arguments[1].isNumber()) {
      _platformContext->raiseError(
          "pagerSetStripOffset: Expected a native id and an offset.");
      return jsi::Value::undefined();
    }
    auto composer = composerFor(static_cast<int>(arguments[0].asNumber()));
    if (composer != nullptr) {
      composer->setStripOffset(static_cast<float>(arguments[1].asNumber()));
    }
    return jsi::Value::undefined();
  }

  JSI_HOST_FUNCTION(pagerSetInputEnabled) {
    if (count != 2 || !arguments[0].isNumber() ||
        !arguments[1].isBool()) {
      _platformContext->raiseError(
          "pagerSetInputEnabled: Expected a numeric native id and boolean.");
      return jsi::Value::undefined();
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer != nullptr) {
      composer->setInputEnabled(arguments[1].getBool());
    }
    return jsi::Value::undefined();
  }

  JSI_HOST_FUNCTION(pagerConfigureMotion) {
    if (count != 11 || !arguments[0].isNumber() ||
        !arguments[1].isNumber() || !arguments[2].isNumber() ||
        !arguments[3].isNumber()) {
      _platformContext->raiseError(
          "pagerConfigureMotion: Expected native id, visual kind, fixed "
          "chrome bounds, six motion arrays, and planar tuning.");
      return jsi::Value::undefined();
    }

    auto readTuning = [&](size_t argumentIndex,
                          PagerCompositor::MotionTuning &tuning) {
      if (!arguments[argumentIndex].isObject()) {
        return false;
      }
      auto object = arguments[argumentIndex].asObject(runtime);
      if (!object.isArray(runtime)) {
        return false;
      }
      auto values = object.asArray(runtime);
      if (values.size(runtime) != 12) {
        return false;
      }
      float numbers[12];
      for (size_t index = 0; index < 12; index += 1) {
        auto value = values.getValueAtIndex(runtime, index);
        if (!value.isNumber()) {
          return false;
        }
        numbers[index] = static_cast<float>(value.asNumber());
      }
      tuning = {
          numbers[0], numbers[1], numbers[2], numbers[3],
          numbers[4], numbers[5], numbers[6], numbers[7],
          numbers[8], numbers[9], numbers[10], numbers[11],
      };
      return true;
    };

    auto readPlanarTuning = [&](
        size_t argumentIndex,
        PagerCompositor::PlanarMotionTuning &tuning) {
      if (!arguments[argumentIndex].isObject()) {
        return false;
      }
      auto object = arguments[argumentIndex].asObject(runtime);
      if (!object.isArray(runtime)) {
        return false;
      }
      auto values = object.asArray(runtime);
      if (values.size(runtime) != 5) {
        return false;
      }
      float numbers[5];
      for (size_t index = 0; index < 5; index += 1) {
        auto value = values.getValueAtIndex(runtime, index);
        if (!value.isNumber()) {
          return false;
        }
        numbers[index] = static_cast<float>(value.asNumber());
      }
      tuning = {
          numbers[0], numbers[1], numbers[2], numbers[3], numbers[4],
      };
      return true;
    };

    PagerCompositor::MotionTuning automaticForward;
    PagerCompositor::MotionTuning automaticBackward;
    PagerCompositor::MotionTuning rapidForward;
    PagerCompositor::MotionTuning rapidBackward;
    PagerCompositor::MotionTuning gestureForward;
    PagerCompositor::MotionTuning gestureBackward;
    PagerCompositor::PlanarMotionTuning planarMotion;
    if (!readTuning(4, automaticForward) ||
        !readTuning(5, automaticBackward) ||
        !readTuning(6, rapidForward) ||
        !readTuning(7, rapidBackward) ||
        !readTuning(8, gestureForward) ||
        !readTuning(9, gestureBackward) ||
        !readPlanarTuning(10, planarMotion)) {
      _platformContext->raiseError(
          "pagerConfigureMotion: Invalid motion tuning arrays.");
      return jsi::Value::undefined();
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer != nullptr) {
      composer->configureMotion(
          arguments[1].asNumber(), arguments[2].asNumber(),
          arguments[3].asNumber(), automaticForward, automaticBackward,
          rapidForward, rapidBackward, gestureForward, gestureBackward,
          planarMotion);
    }
    return jsi::Value::undefined();
  }

  JSI_HOST_FUNCTION(pagerConsumeInput) {
    if (count != 2 || !arguments[0].isNumber() ||
        !arguments[1].isNumber()) {
      _platformContext->raiseError(
          "pagerConsumeInput: Expected native id and direction.");
      return jsi::Value(false);
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      return jsi::Value(false);
    }
    return jsi::Value(
        composer->consumeInput(arguments[1].asNumber()));
  }

  JSI_HOST_FUNCTION(pagerTryConsumeInput) {
    if (count != 2 || !arguments[0].isNumber() ||
        !arguments[1].isNumber()) {
      _platformContext->raiseError(
          "pagerTryConsumeInput: Expected native id and direction.");
      return jsi::Value(false);
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      return jsi::Value(false);
    }
    return jsi::Value(
        composer->tryConsumeInput(arguments[1].asNumber()));
  }

  JSI_HOST_FUNCTION(pagerBeginGesture) {
    if (count != 5 || !arguments[0].isNumber() ||
        !arguments[1].isNumber() || !arguments[2].isNumber() ||
        !arguments[3].isNumber() || !arguments[4].isNumber()) {
      _platformContext->raiseError(
          "pagerBeginGesture: Expected native id, direction, start x, "
          "finger x, and turn progress.");
      return jsi::Value(false);
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      return jsi::Value(false);
    }
    return jsi::Value(composer->beginGesture(
        arguments[1].asNumber(), arguments[2].asNumber(),
        arguments[3].asNumber(), arguments[4].asNumber()));
  }

  JSI_HOST_FUNCTION(pagerUpdateGesture) {
    if (count != 3 || !arguments[0].isNumber() ||
        !arguments[1].isNumber() || !arguments[2].isNumber()) {
      _platformContext->raiseError(
          "pagerUpdateGesture: Expected native id, finger x, and progress.");
      return jsi::Value(false);
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      return jsi::Value(false);
    }
    return jsi::Value(
        composer->updateGesture(
            arguments[1].asNumber(), arguments[2].asNumber()));
  }

  JSI_HOST_FUNCTION(pagerEndGesture) {
    if (count != 13 || !arguments[0].isNumber() ||
        !arguments[1].isNumber() || !arguments[2].isNumber() ||
        !arguments[3].isNumber() || !arguments[4].isNumber() ||
        !arguments[5].isNumber() || !arguments[6].isNumber() ||
        !arguments[7].isNumber() || !arguments[8].isNumber() ||
        !arguments[9].isNumber() || !arguments[10].isNumber() ||
        !arguments[11].isNumber() || !arguments[12].isNumber()) {
      _platformContext->raiseError(
          "pagerEndGesture: Expected native id and twelve gesture values.");
      return jsi::Value(false);
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      return jsi::Value(false);
    }
    return jsi::Value(composer->endGesture(
        arguments[1].asNumber(), arguments[2].asNumber(),
        arguments[3].asNumber(), arguments[4].asNumber(),
        arguments[5].asNumber(), arguments[6].asNumber(),
        arguments[7].asNumber(), arguments[8].asNumber(),
        arguments[9].asNumber(), arguments[10].asNumber(),
        arguments[11].asNumber(), arguments[12].asNumber()));
  }

  JSI_HOST_FUNCTION(pagerCancelGesture) {
    if (count != 1 || !arguments[0].isNumber()) {
      _platformContext->raiseError(
          "pagerCancelGesture: Expected one numeric native id.");
      return jsi::Value(false);
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      return jsi::Value(false);
    }
    return jsi::Value(composer->cancelGesture());
  }

  JSI_HOST_FUNCTION(pagerRunBenchmark) {
    if (count != 4 || !arguments[0].isNumber() ||
        !arguments[1].isNumber() || !arguments[2].isNumber() ||
        !arguments[3].isNumber()) {
      _platformContext->raiseError(
          "pagerRunBenchmark: Expected native id, count, interval, direction.");
      return jsi::Value::undefined();
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer != nullptr) {
      composer->runBenchmark(
          arguments[1].asNumber(), arguments[2].asNumber(),
          arguments[3].asNumber());
    }
    return jsi::Value::undefined();
  }

  JSI_HOST_FUNCTION(pagerTakeEvents) {
    if (count != 1 || !arguments[0].isNumber()) {
      _platformContext->raiseError(
          "pagerTakeEvents: Expected one numeric native id.");
      return jsi::Value::undefined();
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      return jsi::Array(runtime, 0);
    }

    auto events = composer->takeEvents();
    auto result = jsi::Array(runtime, events.size());
    for (size_t index = 0; index < events.size(); index += 1) {
      const auto &event = events[index];
      auto item = jsi::Object(runtime);
      item.setProperty(
          runtime, "id", jsi::String::createFromUtf8(runtime, event.id));
      item.setProperty(
          runtime, "event",
          jsi::String::createFromUtf8(runtime, event.type));
      item.setProperty(runtime, "eventAtMs", event.epochMs);
      if (event.direction != 0) {
        item.setProperty(runtime, "direction", event.direction);
      }
      result.setValueAtIndex(runtime, index, std::move(item));
    }
    return result;
  }

  JSI_HOST_FUNCTION(pagerReset) {
    if (count != 1 || !arguments[0].isNumber()) {
      _platformContext->raiseError(
          "pagerReset: Expected one numeric native id.");
      return jsi::Value::undefined();
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer != nullptr) {
      composer->reset();
    }
    return jsi::Value::undefined();
  }

  JSI_HOST_FUNCTION(pagerProtocolVersion) {
    if (count != 0) {
      _platformContext->raiseError(
          "pagerProtocolVersion: Expected no arguments.");
      return jsi::Value::undefined();
    }
    return jsi::Value(kReaderComposerProtocolVersion);
  }

  JSI_HOST_FUNCTION(pagerReady) {
    if (count != 1 || !arguments[0].isNumber()) {
      _platformContext->raiseError(
          "pagerReady: Expected one numeric native id.");
      return jsi::Value::undefined();
    }
    const int nativeId = arguments[0].asNumber();
    return jsi::Value(composerFor(nativeId) != nullptr);
  }

  JSI_EXPORT_FUNCTIONS(JSI_EXPORT_FUNC(ReaderComposerApi, pagerProtocolVersion),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerReady),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerPresent),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerStockPicture),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerSetRestingOffset),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerSetStrip),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerSetStripOffset),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerSetInputEnabled),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerConfigureMotion),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerConsumeInput),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerTryConsumeInput),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerBeginGesture),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerUpdateGesture),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerEndGesture),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerCancelGesture),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerRunBenchmark),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerTakeEvents),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerReset))

private:
  /**
   * The compositor of the picture view registered under `nativeId`. The
   * pointer shares ownership of its extension, so a view unregistered on
   * another thread cannot free the compositor during the call.
   */
  static std::shared_ptr<PagerCompositor> composerFor(int nativeId) {
    auto view = ViewRegistry::getInstance().withViewInfo(
        static_cast<size_t>(nativeId),
        [](std::shared_ptr<RNSkViewInfo> info) { return info->view; });
    auto pictureView = std::dynamic_pointer_cast<RNSkPictureView>(view);
    if (pictureView == nullptr) {
      return nullptr;
    }
    auto extension = std::dynamic_pointer_cast<ReaderComposerExtension>(
        pictureView->getExtension());
    if (extension == nullptr) {
      return nullptr;
    }
    return std::shared_ptr<PagerCompositor>(extension, &extension->compositor());
  }

  std::shared_ptr<RNSkPlatformContext> _platformContext;
};

} // namespace lunar::reader

namespace RNSkia {

void registerPictureExtension() {
  RNSkPictureExtensionRegistry::factory() =
      [](std::function<void()> requestRedraw)
      -> std::shared_ptr<RNSkPictureExtension> {
    return std::make_shared<lunar::reader::ReaderComposerExtension>(
        std::move(requestRedraw));
  };
  RNSkPictureExtensionRegistry::bindingsInstaller() =
      [](jsi::Runtime &runtime,
         std::shared_ptr<RNSkPlatformContext> platformContext) {
        runtime.global().setProperty(
            runtime, "ReaderComposerApi",
            jsi::Object::createFromHostObject(
                runtime, std::make_shared<lunar::reader::ReaderComposerApi>(
                             std::move(platformContext))));
      };
}

} // namespace RNSkia
