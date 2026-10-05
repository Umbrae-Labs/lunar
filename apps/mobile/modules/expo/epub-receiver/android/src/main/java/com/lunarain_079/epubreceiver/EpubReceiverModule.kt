package com.lunarain_079.epubreceiver

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

class EpubReceiverModule : Module() {
  private var initialShareConsumed = false
  private val pendingShares = mutableListOf<String>()

  override fun definition() = ModuleDefinition {
    Name("LunarEpubReceiver")
    Events("onShare")

    Function("takeInitialShareUris") {
      if (initialShareConsumed) emptyList<String>() else {
        initialShareConsumed = true
        val intent = appContext.currentActivity?.intent
        shareUris(intent).also { intent?.removeExtra(Intent.EXTRA_STREAM) }
      }
    }

    Function("takePendingShareUris") {
      synchronized(pendingShares) {
        pendingShares.toList().also { pendingShares.clear() }
      }
    }

    OnNewIntent { intent ->
      val uris = shareUris(intent)
      if (uris.isNotEmpty()) {
        intent.removeExtra(Intent.EXTRA_STREAM)
        synchronized(pendingShares) { pendingShares.addAll(uris) }
        sendEvent("onShare", emptyMap<String, String>())
      }
    }

    AsyncFunction("stageEpub") { value: String ->
      val context = appContext.reactContext ?: error("Application context is unavailable.")
      val uri = Uri.parse(value)
      require(uri.scheme == "content" || uri.scheme == "file") { "Unsupported file URI." }
      val resolver = context.contentResolver
      var name = uri.lastPathSegment ?: "book.epub"
      if (uri.scheme == "content") {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) {
            val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (column >= 0 && !cursor.isNull(column)) name = cursor.getString(column)
          }
        }
      }
      if (!name.endsWith(".epub", ignoreCase = true) && resolver.getType(uri) == "application/epub+zip" && !name.contains('.')) {
        name += ".epub"
      }
      require(name.endsWith(".epub", ignoreCase = true)) { "Only EPUB files can be imported." }
      val directory = File(context.cacheDir, "external-epubs").apply { mkdirs() }
      val target = File(directory, "${UUID.randomUUID()}.epub")
      try {
        val input = if (uri.scheme == "file") File(requireNotNull(uri.path)).inputStream() else resolver.openInputStream(uri)
        requireNotNull(input) { "The EPUB file cannot be read." }.use { source ->
          target.outputStream().use { output ->
            val buffer = ByteArray(65536)
            var total = 0L
            while (true) {
              val count = source.read(buffer)
              if (count < 0) break
              total += count
              require(total <= 100L * 1024 * 1024) { "The EPUB exceeds the 100 MiB limit." }
              output.write(buffer, 0, count)
            }
          }
        }
        mapOf("uri" to Uri.fromFile(target).toString(), "fileName" to name)
      } catch (error: Exception) {
        target.delete()
        throw error
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun shareUris(intent: Intent?): List<String> {
    if (intent == null) return emptyList()
    val uris = when (intent.action) {
      Intent.ACTION_SEND -> listOfNotNull(intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))
      Intent.ACTION_SEND_MULTIPLE -> intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM) ?: emptyList()
      else -> return emptyList()
    }
    return uris.filter { it.scheme == "content" || it.scheme == "file" }.map { it.toString() }.distinct()
  }
}
