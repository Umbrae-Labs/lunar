import ExpoModulesCore
import Foundation

public final class EpubReceiverModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LunarEpubReceiver")

    AsyncFunction("stageEpub") { (value: String) -> [String: String] in
      guard let source = URL(string: value), source.isFileURL,
            source.pathExtension.lowercased() == "epub" else {
        throw NSError(domain: "LunarEpubReceiver", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "Only EPUB files can be imported."])
      }
      let scoped = source.startAccessingSecurityScopedResource()
      defer { if scoped { source.stopAccessingSecurityScopedResource() } }
      let files = FileManager.default
      let directory = files.temporaryDirectory.appendingPathComponent("external-epubs", isDirectory: true)
      try files.createDirectory(at: directory, withIntermediateDirectories: true)
      let target = directory.appendingPathComponent("\(UUID().uuidString).epub")
      var coordinationError: NSError?
      var copyError: Error?
      NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinationError) { readable in
        do {
          let size = try readable.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
          guard size <= 100 * 1024 * 1024 else {
            throw NSError(domain: "LunarEpubReceiver", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "The EPUB exceeds the 100 MiB limit."])
          }
          try files.copyItem(at: readable, to: target)
        } catch { copyError = error }
      }
      if let error = (coordinationError as Error?) ?? copyError {
        try? files.removeItem(at: target)
        throw error
      }
      return ["uri": target.absoluteString, "fileName": source.lastPathComponent]
    }
  }
}
