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
// RNSkJsiViewApi.h relies on JsiSkApi.h for JsiPromises, as in RNSkManager.cpp.
#include "JsiSkApi.h"
#include "JsiSkImage.h"
#include "JsiSkPicture.h"
#include "RNSkJsiViewApi.h"
#include "RNSkPictureExtension.h"
#include "RNSkPictureView.h"
#include "RNSkPlatformContext.h"

#include "ReaderComposerExtension.h"

namespace lunar::reader {

namespace jsi = facebook::jsi;

using RNSkia::JsiSkImage;
using RNSkia::JsiSkPicture;
using RNSkia::RNSkPictureView;
using RNSkia::RNSkPlatformContext;
using RNSkia::RNSkViewInfo;
using RNSkia::ViewRegistry;

/** The protocol the TS adapter checks before it uses this API. */
constexpr int kReaderComposerProtocolVersion = 13;

class ReaderComposerApi final : public RNJsi::JsiHostObject {
public:
  explicit ReaderComposerApi(std::shared_ptr<RNSkPlatformContext> platformContext)
      : _platformContext(std::move(platformContext)) {}

  JSI_HOST_FUNCTION(pagerPreload) {
    if (count != 2 || !arguments[0].isNumber() ||
        !arguments[1].isObject()) {
      _platformContext->raiseError(
          "pagerPreload: Expected a numeric native id and an SkImage.");
      return jsi::Value::undefined();
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      return jsi::Value::undefined();
    }
    composer->preload(
        JsiSkImage::fromValue(runtime, arguments[1]));
    return jsi::Value::undefined();
  }

  JSI_HOST_FUNCTION(pagerEnqueue) {
    if (count != 10) {
      _platformContext->raiseError(
          std::string("pagerEnqueue: Expected 10 arguments, got " +
                      std::to_string(count) + "."));
      return jsi::Value::undefined();
    }
    if (!arguments[0].isNumber() || !arguments[1].isString() ||
        !arguments[2].isObject() || !arguments[4].isNumber() ||
        !arguments[5].isBool() || !arguments[6].isNumber() ||
        !arguments[7].isNumber() || !arguments[8].isNumber() ||
        !arguments[9].isNumber()) {
      _platformContext->raiseError(
          "pagerEnqueue: Invalid pager command arguments.");
      return jsi::Value::undefined();
    }

    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      _platformContext->raiseError(
          "pagerEnqueue: No Skia PictureView is registered for this id.");
      return jsi::Value::undefined();
    }

    auto id = arguments[1].asString(runtime).utf8(runtime);
    auto frontImage = JsiSkImage::fromValue(runtime, arguments[2]);
    sk_sp<SkImage> backImage = nullptr;
    if (!arguments[3].isNull() && !arguments[3].isUndefined()) {
      if (!arguments[3].isObject()) {
        _platformContext->raiseError(
            "pagerEnqueue: Back image must be an SkImage or null.");
        return jsi::Value::undefined();
      }
      backImage = JsiSkImage::fromValue(runtime, arguments[3]);
    }
    const int direction = arguments[4].asNumber();
    const bool spread = arguments[5].getBool();
    const double startAtEpochMs = arguments[6].asNumber();
    const double durationMs = arguments[7].asNumber();
    const double launchIntervalMs = arguments[8].asNumber();
    const SkColor paperColor =
        static_cast<SkColor>(arguments[9].asNumber());
    composer->enqueue(
        std::move(id), std::move(frontImage), std::move(backImage), direction,
        spread, startAtEpochMs, durationMs, launchIntervalMs, paperColor);
    return jsi::Value::undefined();
  }

  JSI_HOST_FUNCTION(pagerEnqueuePicture) {
    if (count != 14) {
      _platformContext->raiseError(
          std::string("pagerEnqueuePicture: Expected 14 arguments, got " +
                      std::to_string(count) + "."));
      return jsi::Value::undefined();
    }
    const auto optionalObject = [](const jsi::Value &value) {
      return value.isNull() || value.isUndefined() || value.isObject();
    };
    if (!arguments[0].isNumber() || !arguments[1].isString() ||
        !arguments[2].isObject() || !optionalObject(arguments[3]) ||
        !optionalObject(arguments[4]) || !optionalObject(arguments[5]) ||
        !arguments[6].isNumber() || !arguments[7].isNumber() ||
        !arguments[8].isNumber() || !arguments[9].isBool() ||
        !arguments[10].isNumber() || !arguments[11].isNumber() ||
        !arguments[12].isNumber() || !arguments[13].isNumber()) {
      _platformContext->raiseError(
          "pagerEnqueuePicture: Invalid pager picture command arguments.");
      return jsi::Value::undefined();
    }

    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      _platformContext->raiseError(
          "pagerEnqueuePicture: No Skia PictureView is registered for this id.");
      return jsi::Value::undefined();
    }

    auto id = arguments[1].asString(runtime).utf8(runtime);
    const auto optionalPicture = [&runtime, &arguments](size_t index) {
      return arguments[index].isNull() || arguments[index].isUndefined()
                 ? sk_sp<SkPicture>(nullptr)
                 : JsiSkPicture::fromValue(runtime, arguments[index]);
    };
    auto frontPicture = JsiSkPicture::fromValue(runtime, arguments[2]);
    auto backPicture = optionalPicture(3);
    auto backgroundLeftPicture = optionalPicture(4);
    auto backgroundRightPicture = optionalPicture(5);
    const int pixelWidth = arguments[6].asNumber();
    const int pixelHeight = arguments[7].asNumber();
    const int direction = arguments[8].asNumber();
    const bool spread = arguments[9].getBool();
    const double startAtEpochMs = arguments[10].asNumber();
    const double durationMs = arguments[11].asNumber();
    const double launchIntervalMs = arguments[12].asNumber();
    const SkColor paperColor =
        static_cast<SkColor>(arguments[13].asNumber());
    composer->enqueuePicture(
        std::move(id), std::move(frontPicture), std::move(backPicture),
        std::move(backgroundLeftPicture),
        std::move(backgroundRightPicture), pixelWidth, pixelHeight, direction,
        spread, startAtEpochMs, durationMs, launchIntervalMs, paperColor);
    return jsi::Value::undefined();
  }

  JSI_HOST_FUNCTION(pagerSetAnchor) {
    if (count != 2 || !arguments[0].isNumber() ||
        !arguments[1].isString()) {
      _platformContext->raiseError(
          "pagerSetAnchor: Expected a numeric native id and page key.");
      return jsi::Value::undefined();
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      return jsi::Value::undefined();
    }
    composer->setAnchor(
        arguments[1].asString(runtime).utf8(runtime));
    return jsi::Value::undefined();
  }

  JSI_HOST_FUNCTION(pagerAcknowledgePresentation) {
    if (count != 2 || !arguments[0].isNumber() ||
        !arguments[1].isString()) {
      _platformContext->raiseError(
          "pagerAcknowledgePresentation: Expected a numeric native id and "
          "turn id.");
      return jsi::Value::undefined();
    }
    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      return jsi::Value::undefined();
    }
    composer->acknowledgePresentation(
        arguments[1].asString(runtime).utf8(runtime));
    return jsi::Value::undefined();
  }

  JSI_HOST_FUNCTION(pagerStockPicture) {
    if (count != 21) {
      _platformContext->raiseError(
          std::string("pagerStockPicture: Expected 21 arguments, got " +
                      std::to_string(count) + "."));
      return jsi::Value::undefined();
    }
    const auto optionalString = [](const jsi::Value &value) {
      return value.isNull() || value.isUndefined() || value.isString();
    };
    const auto optionalObject = [](const jsi::Value &value) {
      return value.isNull() || value.isUndefined() || value.isObject();
    };
    if (!arguments[0].isNumber() || !arguments[1].isString() ||
        !arguments[2].isString() || !arguments[3].isString() ||
        !arguments[4].isString() || !optionalString(arguments[5]) ||
        !optionalString(arguments[6]) || !optionalString(arguments[7]) ||
        !arguments[8].isObject() || !optionalObject(arguments[9]) ||
        !optionalObject(arguments[10]) || !optionalObject(arguments[11]) ||
        !arguments[12].isNumber() || !arguments[13].isNumber() ||
        !arguments[14].isNumber() || !arguments[15].isBool() ||
        !arguments[16].isNumber() || !arguments[17].isNumber() ||
        !arguments[18].isNumber() || !arguments[19].isNumber() ||
        !arguments[20].isNumber()) {
      _platformContext->raiseError(
          "pagerStockPicture: Invalid native pager stock arguments.");
      return jsi::Value::undefined();
    }

    const int nativeId = arguments[0].asNumber();
    auto composer = composerFor(nativeId);
    if (composer == nullptr) {
      return jsi::Value::undefined();
    }

    const auto optionalUtf8 =
        [&runtime, &arguments](size_t index) -> std::string {
      return arguments[index].isNull() || arguments[index].isUndefined()
                 ? std::string()
                 : arguments[index].asString(runtime).utf8(runtime);
    };
    const auto optionalPicture = [&runtime, &arguments](size_t index) {
      return arguments[index].isNull() || arguments[index].isUndefined()
                 ? sk_sp<SkPicture>(nullptr)
                 : JsiSkPicture::fromValue(runtime, arguments[index]);
    };
    composer->stockPicture(
        arguments[1].asString(runtime).utf8(runtime),
        arguments[2].asString(runtime).utf8(runtime),
        arguments[3].asString(runtime).utf8(runtime),
        arguments[4].asString(runtime).utf8(runtime), optionalUtf8(5),
        optionalUtf8(6), optionalUtf8(7),
        JsiSkPicture::fromValue(runtime, arguments[8]),
        optionalPicture(9), optionalPicture(10), optionalPicture(11),
        arguments[12].asNumber(), arguments[13].asNumber(),
        arguments[14].asNumber(), arguments[15].getBool(),
        arguments[16].asNumber(), arguments[17].asNumber(),
        arguments[18].asNumber(), arguments[19].asNumber(),
        static_cast<SkColor>(arguments[20].asNumber()));
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
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerPreload),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerEnqueue),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerEnqueuePicture),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerSetAnchor),
                       JSI_EXPORT_FUNC(ReaderComposerApi,
                                       pagerAcknowledgePresentation),
                       JSI_EXPORT_FUNC(ReaderComposerApi, pagerStockPicture),
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
