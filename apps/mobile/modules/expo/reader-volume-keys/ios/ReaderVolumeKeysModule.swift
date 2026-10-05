import AVFoundation
import ExpoModulesCore
import Foundation
import MediaPlayer
import UIKit

public final class ReaderVolumeKeysModule: Module {
  private var enabled = false
  private var volumeObserver: ReaderVolumeObserver?

  public func definition() -> ModuleDefinition {
    Name("LunarReaderVolumeKeys")
    Events("onVolumeKey")

    Function("setEnabled") { (isEnabled: Bool) in
      self.setEnabled(isEnabled)
    }

    OnAppEntersForeground {
      DispatchQueue.main.async {
        if self.enabled {
          self.startObservingOnMainThread()
        }
      }
    }

    OnAppEntersBackground {
      self.stopObserving()
    }

    OnDestroy {
      self.setEnabled(false)
    }
  }

  private func setEnabled(_ isEnabled: Bool) {
    DispatchQueue.main.async {
      self.enabled = isEnabled
      if isEnabled && UIApplication.shared.applicationState == .active {
        self.startObservingOnMainThread()
      } else {
        self.stopObservingOnMainThread()
      }
    }
  }

  private func startObservingOnMainThread() {
    guard volumeObserver == nil else { return }
    volumeObserver = ReaderVolumeObserver { [weak self] direction in
      self?.sendEvent("onVolumeKey", ["direction": direction])
    }
  }

  private func stopObserving() {
    DispatchQueue.main.async {
      self.stopObservingOnMainThread()
    }
  }

  private func stopObservingOnMainThread() {
    volumeObserver?.stop()
    volumeObserver = nil
  }
}

private final class ReaderVolumeObserver {
  private let session = AVAudioSession.sharedInstance()
  private let onPress: (String) -> Void
  private let originalCategory: AVAudioSession.Category
  private let originalOptions: AVAudioSession.CategoryOptions
  private var volumeView: MPVolumeView?
  private var observation: NSKeyValueObservation?
  private var lastVolume: Float
  private var isRestoring = false
  private var expectedRestore: Float?
  private var isActive = true
  private var sessionActivated = false
  private var categoryChanged = false

  init(onPress: @escaping (String) -> Void) {
    self.onPress = onPress
    self.originalCategory = session.category
    self.originalOptions = session.categoryOptions
    self.lastVolume = session.outputVolume

    do {
      try session.setCategory(.ambient, options: .mixWithOthers)
      categoryChanged = true
      try session.setActive(true)
      sessionActivated = true
    } catch {
      // Volume observation can still work if another module owns the audio session.
    }

    let view = MPVolumeView(frame: CGRect(x: -1000, y: -1000, width: 1, height: 1))
    view.showsRouteButton = false
    view.alpha = 0.01
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }
    scene?.windows.first { $0.isKeyWindow }?.addSubview(view)
    view.layoutIfNeeded()
    volumeView = view

    lastVolume = session.outputVolume
    observation = session.observe(\.outputVolume, options: [.old, .new]) { [weak self] _, change in
      let previous = change.oldValue
      let current = change.newValue
      DispatchQueue.main.async { [weak self] in
        self?.handleVolumeChange(previous: previous, current: current)
      }
    }
  }

  func stop() {
    isActive = false
    observation?.invalidate()
    observation = nil
    volumeView?.removeFromSuperview()
    volumeView = nil
    if sessionActivated {
      try? session.setActive(false, options: .notifyOthersOnDeactivation)
    }
    if categoryChanged {
      try? session.setCategory(originalCategory, options: originalOptions)
    }
  }

  private func handleVolumeChange(previous: Float?, current: Float?) {
    guard isActive else { return }
    let before = previous ?? lastVolume
    let after = current ?? session.outputVolume
    if let expectedRestore, abs(after - expectedRestore) < 0.001 {
      lastVolume = after
      isRestoring = false
      self.expectedRestore = nil
      return
    }
    guard !isRestoring else { return }
    guard UIApplication.shared.applicationState == .active else {
      lastVolume = after
      return
    }
    guard abs(after - before) > 0.001 else { return }

    lastVolume = after
    onPress(after > before ? "previous" : "next")

    guard let volumeView, let slider = findSlider(in: volumeView) else { return }
    isRestoring = true
    expectedRestore = before
    slider.setValue(before, animated: false)
    slider.sendActions(for: .valueChanged)
    lastVolume = before
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
      self?.isRestoring = false
      self?.expectedRestore = nil
    }
  }

  private func findSlider(in view: UIView) -> UISlider? {
    if let slider = view as? UISlider { return slider }
    for child in view.subviews {
      if let slider = findSlider(in: child) { return slider }
    }
    return nil
  }
}
