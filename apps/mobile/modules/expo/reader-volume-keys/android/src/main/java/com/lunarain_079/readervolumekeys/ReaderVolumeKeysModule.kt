package com.lunarain_079.readervolumekeys

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

internal object ReaderVolumeKeyState {
  @Volatile var enabled = false
  @Volatile var onKeyPress: ((String) -> Unit)? = null
}

class ReaderVolumeKeysModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LunarReaderVolumeKeys")
    Events("onVolumeKey")

    OnCreate {
      ReaderVolumeKeyState.onKeyPress = { direction ->
        sendEvent("onVolumeKey", mapOf("direction" to direction))
      }
    }

    OnDestroy {
      ReaderVolumeKeyState.enabled = false
      ReaderVolumeKeyState.onKeyPress = null
    }

    Function("setEnabled") { enabled: Boolean ->
      ReaderVolumeKeyState.enabled = enabled
    }
  }
}
