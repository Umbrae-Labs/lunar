package com.lunarain_079.readervolumekeys

import android.content.Context
import android.view.KeyEvent
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler

class ReaderVolumeKeysPackage : Package {
  override fun createReactActivityHandlers(activityContext: Context): List<ReactActivityHandler> =
    listOf(ReaderVolumeKeyHandler())
}

private class ReaderVolumeKeyHandler : ReactActivityHandler {
  private val consumedPresses = mutableMapOf<Pair<Int, Int>, Long>()

  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    val direction = directionFor(keyCode) ?: return false
    val pressKey = keyCode to (event?.deviceId ?: 0)
    // Finish consuming an intercepted press even if the reader is disabled mid-press.
    val continuingPress = event != null && consumedPresses[pressKey] == event.downTime
    if (!ReaderVolumeKeyState.enabled && !continuingPress) {
      consumedPresses.remove(pressKey)
      return false
    }
    if (event != null) consumedPresses[pressKey] = event.downTime
    if (ReaderVolumeKeyState.enabled && event?.repeatCount == 0) {
      ReaderVolumeKeyState.onKeyPress?.invoke(direction)
    }
    return true
  }

  override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
    if (directionFor(keyCode) == null) return false
    val consumedDownTime = consumedPresses.remove(keyCode to event.deviceId)
    return consumedDownTime == event.downTime || ReaderVolumeKeyState.enabled
  }

  private fun directionFor(keyCode: Int): String? = when (keyCode) {
    KeyEvent.KEYCODE_VOLUME_UP -> "previous"
    KeyEvent.KEYCODE_VOLUME_DOWN -> "next"
    else -> null
  }
}
