#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include "PagerTurn.h"

namespace lunar::reader {

/**
 * A deliberately small native page compositor.
 *
 * React owns pagination and supplies immutable page images. Once a command is
 * accepted, however, image retention, burst compression, the animation clock,
 * paper geometry, and drawing all stay in C++. No per-frame JSI property or
 * React tree update is required.
 */
class PagerCompositor {
public:
  explicit PagerCompositor(std::function<void()> requestRedraw)
      : _requestRedraw(std::move(requestRedraw)) {}

  void configureMotion(int visualKind, float fixedChromeTop,
                       float fixedChromeBottom,
                       MotionTuning automaticForward,
                       MotionTuning automaticBackward,
                       MotionTuning rapidForward, MotionTuning rapidBackward,
                       MotionTuning gestureForward,
                       MotionTuning gestureBackward,
                       PlanarMotionTuning planarMotion);

  /**
   * The page the reader runtime shows. The composer draws it at rest and
   * turns away from it; nothing else paints pages.
   *
   * - The current page again: its paint changed; no turn.
   * - A page the composer already turned to on its own, ahead of the runtime
   *   (taps, released drags): the runtime is catching up; nothing moves.
   * - Another page with a direction: a turn from the shown page to it.
   * - Otherwise, or with `force`: the composer jumps there, ending its turns.
   */
  void present(PageMaterial page, int transition, double durationMs,
               double launchIntervalMs, bool force);

  /**
   * Shows `windows` as one strip scrolled by setStripOffset, in place of the
   * resting page and its turns; an empty list ends the strip. Windows are
   * retained like any page, so their textures upload nearest the view first.
   */
  void setStrip(std::vector<StripWindow> windows);

  /** Scrolls the strip so view y 0 shows strip position `offset`; UI thread. */
  void setStripOffset(float offset);

  /**
   * Moves the resting page down by `offset` while a bookmark pull drags it,
   * over `revealColor`. Called from the UI thread on every pull frame.
   */
  void setRestingOffset(float offset, SkColor revealColor);

  /**
   * Holds the edge from `source` to `target` for input the composer takes
   * by itself: a tap, a held riffle or a drag. Faces are derived here, so a
   * curling spread turns its half pages from the same two recordings.
   */
  void stockPicture(std::string id, PageMaterial source, PageMaterial target,
                    int direction, double durationMs, double rapidDurationMs,
                    double launchIntervalMs);

  void setInputEnabled(bool enabled);

  bool consumeInput(int direction);

  // A held riffle is live input, not deferred intent. Consume a stocked page
  // now or drop this cadence tick so releasing the finger is an exact stop.
  bool tryConsumeInput(int direction);

  bool beginGesture(int direction, float startBookX, float fingerX,
                    float turnProgress);

  bool updateGesture(float fingerX, float turnProgress);

  bool endGesture(float fingerX, float pageWidth, float throwVelocity,
                  float throwAcceleration, float pageWeight,
                  float commitThreshold, float slowCommitEdgeX,
                  float minimumSpeedScale, float maximumSpeedScale,
                  float velocityGain, float idleDecaySeconds,
                  float releaseProjectionSeconds);

  bool cancelGesture();

  void runBenchmark(int count, double intervalMs, int direction);

  void reset();

  std::vector<Event> takeEvents();

  // A turn is not visible merely because draw() built its geometry. Its clock
  // starts only once the display-backed provider submitted its first frame,
  // so an unavailable drawable cannot consume animation time.
  void commitPresentedFrame();

  bool hasActiveTurns() const;

  void draw(SkCanvas *canvas, float viewportWidth, float viewportHeight,
            GrDirectContext *directContext, bool displayPresentation);

private:
  /**
   * A horizontal band of a strip window, uploaded as its own texture: a new
   * window then costs a few short uploads over as many frames instead of one
   * viewport-sized upload in a single frame.
   */
  struct StripBand {
    std::string textureKey;
    sk_sp<SkPicture> picture;
    int pixelTop = 0;
    int pixelHeight = 0;
  };

  struct StripEntry {
    float top = 0;
    float length = 0;
    int pixelWidth = 0;
    int pixelHeight = 0;
    SkColor paperColor = SK_ColorWHITE;
    std::vector<StripBand> bands;
  };

  // JS publishes a radius-ten bidirectional graph: 20 directed segments with
  // their reverse edges, for 40 entries total. Retaining older graph windows
  // only leaves edges whose page material can no longer fit in the bounded
  // picture table.
  static constexpr size_t kMaximumStockCount = 40;
  static constexpr size_t kMaximumPendingDirectInputCount = 64;
  static constexpr uint8_t kMaximumPageTextureUploadFailureCount = 3;
  // Each retained edge names at most six capture identities: its two whole
  // pages and, for a curling spread, four half pages. Decoration and slot
  // identity mean rolling spread windows cannot safely be reduced to a count
  // of physical pages. Bound the CPU display-list table by the actual
  // StockEntry contract; GPU textures remain governed by the much smaller
  // count and byte caps below.
  static constexpr size_t kMaximumRetainedPagePictureCount =
      kMaximumStockCount * 6;
  // Four preferred-direction pages plus a three-page reversal runway are
  // enough for the dedicated render thread to refill at 10 turns/second.
  // The count remains a safety ceiling for spread mode; the byte ceiling is
  // authoritative so a single-column page cannot consume twice the budget.
  static constexpr size_t kMaximumPreparedPageCount = 8;
  // A strip window is cut into this many bands. Five windows of bands stay
  // within the byte ceiling, which remains authoritative.
  static constexpr int kStripBandCount = 4;
  static constexpr size_t kMaximumPreparedStripBandCount = 24;
  static constexpr size_t kMaximumPreparedPageBytes =
      72 * 1024 * 1024;

  struct StockEntry {
    std::string id;
    std::string fromPageKey;
    std::string toPageKey;
    // Picture ownership belongs to the bounded page-texture table. Keeping
    // another sk_sp per graph edge lets a rolling runway retain gigabytes.
    std::string sourceTextureKey;
    std::string targetTextureKey;
    TurnFaces faces;
    int pixelWidth = 0;
    int pixelHeight = 0;
    int direction = 1;
    bool spread = false;
    double durationMs = kDefaultDurationMs;
    double rapidDurationMs = kDefaultDurationMs;
    double launchIntervalMs = 100;
    SkColor paperColor = SK_ColorWHITE;
    uint64_t lastUsed = 0;
    sk_sp<SkPicture> sourceChromePicture;
    sk_sp<SkPicture> targetChromePicture;
  };

  struct PendingDirectInput {
    int direction;
  };

  struct PageTexture {
    std::string pageKey;
    sk_sp<SkPicture> picture;
    sk_sp<SkImage> image;
    int pixelWidth;
    int pixelHeight;
    uint64_t lastUsed;
    bool uploadPending = false;
    uint8_t uploadFailureCount = 0;
  };

  struct PendingPageTexture {
    std::string pageKey;
    sk_sp<SkPicture> picture;
    int pixelWidth;
    int pixelHeight;
  };

  static double steadyNowMs() {
    return std::chrono::duration<double, std::milli>(
               std::chrono::steady_clock::now().time_since_epoch())
        .count();
  }

  static double epochNowMs() {
    return std::chrono::duration<double, std::milli>(
               std::chrono::system_clock::now().time_since_epoch())
        .count();
  }

  static std::string pageTextureKey(uint64_t contentRevision,
                                    const std::string &pageKey) {
    return std::to_string(contentRevision) + "@" + pageKey;
  }

  // PagerCompositor.cpp

  void advanceCurrentPageLocked(const std::string &pageKey);

  /** The composer moved on by itself; the runtime presents this page later. */
  void leadToPageLocked(const std::string &pageKey);

  /**
   * Binds a presented turn once every face is uploaded. A face that keeps
   * failing to upload ends the turn on its target instead of spinning the
   * render thread forever.
   */
  void bindPresentedTurnFacesLocked(Turn &turn, double nowEpochMs);

  /**
   * Ends a turn. A committed turn that is still the latest logical move lands:
   * its target becomes the resting page.
   */
  void finishTurnLocked(Turn &turn, double nowEpochMs);

  /** Turns from the shown page to `page`, which becomes current right away. */
  void queuePresentedTurnLocked(PageMaterial page, int direction,
                                double durationMs, double launchIntervalMs,
                                double nowSteadyMs);

  /** Shows `page` at once: every turn ends where it is and nothing leads. */
  void jumpLocked(PageMaterial page, double nowEpochMs);

  bool beginDirectionEpochLocked(int direction, double nowSteadyMs,
                                 double nowEpochMs);

  // PagerCompositorInput.cpp

  std::vector<Turn>::iterator activeGestureLocked();

  void consumeGestureLocked(Turn &turn, double nowEpochMs);

  void releaseGestureLocked(Turn &turn, bool commit, float throwVelocity,
                            float minimumSpeedScale,
                            float maximumSpeedScale, float velocityGain,
                            float pageWidth, double nowSteadyMs,
                            double nowEpochMs);

  void drainPendingDirectInputsLocked(double nowSteadyMs,
                                      double nowEpochMs);

  void processBenchmarkTaps();

  // PagerCompositorStock.cpp

  /** The page an edge lands on, to rest on screen once its turn ends. */
  PageMaterial stockTargetLocked(const StockEntry &stock) const;

  /** Fills a turn the composer takes from a stocked edge whose faces are ready. */
  void bindStockTurnLocked(Turn &turn, const StockEntry &stock);

  const StockEntry *stockEdgeLocked(const std::string &fromPageKey,
                                    int direction) const;

  std::vector<std::pair<std::string, int>> stockPageDistancesLocked() const;

  static int stockEntryDistanceLocked(
      const StockEntry &entry,
      const std::vector<std::pair<std::string, int>> &pageDistances);

  bool stockMaterialAvailableLocked(const StockEntry &entry) const;

  bool stockTexturesReadyLocked(const StockEntry &entry) const;

  void prioritizeRapidStockDemandLocked(const StockEntry &entry,
                                         int direction);

  bool stockAvailableLocked(int direction) const;

  void emitStockMissLocked(int direction, double nowEpochMs,
                           const char *reason = "stock-miss");

  std::string nextStockTurnIdLocked(const std::string &stockId,
                                    bool rapidInput = false);

  bool consumeStockLocked(int direction, double nowSteadyMs,
                          double nowEpochMs,
                          bool directInput = false,
                          bool emitStockMiss = true,
                          bool rapidInput = false);

  // PagerCompositorTextures.cpp

  static bool stockReferencesPageTextureLocked(
      const StockEntry &entry, const std::string &pageKey);

  /**
   * Whether a page-table entry is still named by something that will draw it:
   * a stocked edge, a pending turn, or the page resting on screen.
   */
  bool pageTextureReferencedLocked(const std::string &pageKey) const;

  PageTexture *pageTextureLocked(const std::string &pageKey);

  const PageTexture *pageTextureLocked(const std::string &pageKey) const;

  /**
   * Keeps `picture` in the page table under `pageKey`. A StockEntry is an
   * addressable promise: as long as the edge survives, every SkPicture it
   * names must survive too. GPU images may be dropped and rebuilt, but
   * erasing a referenced entry leaves an edge that can never become drawable
   * again. `incomingPageKeys` are protected while their edge is assembled.
   */
  bool retainPageMaterialLocked(
      const std::string &pageKey, const sk_sp<SkPicture> &picture,
      int pixelWidth, int pixelHeight,
      const std::vector<std::string> &incomingPageKeys);

  size_t preparedPageCountLimitLocked() const;

  /** Retains one face's material under `key`, deriving a half page once. */
  bool retainFaceLocked(const std::string &key, const PageMaterial &page,
                        int half, const std::vector<std::string> &incoming);

  /**
   * Retains both pages of a turn from `source` to `target` and derives the
   * faces it draws. False when the bounded page table cannot hold them.
   */
  bool retainTurnFacesLocked(const PageMaterial &source,
                             const PageMaterial &target, int direction,
                             TurnFaces &faces);

  /** The prepared image of every non-empty face; false while one is missing. */
  bool resolveFacesLocked(const TurnFaces &faces, Turn &turn);

  std::vector<std::string> prioritizedPageKeysLocked() const;

  bool hasPendingPageTextureWorkLocked() const;

  sk_sp<SkImage> preparedPageImageLocked(const std::string &pageKey);

  sk_sp<SkPicture>
  retainedPagePictureLocked(const std::string &pageKey) const;

  bool pageMaterialAvailableLocked(const std::string &pageKey) const;

  bool pageTextureReadyLocked(const std::string &pageKey) const;

  void rearmPageTextureUploadLocked(const std::string &pageKey);

  static size_t estimatedPageTextureBytes(const PageTexture &page);

  void prepareStockTextures(GrDirectContext *directContext);

  // PagerCompositorStrip.cpp

  /**
   * Draws the strip when one is shown; false otherwise. Each window shows its
   * uploaded texture, or its picture until the texture is ready, clipped to
   * the length its content runs.
   */
  bool drawStrip(SkCanvas *canvas, float viewportWidth, float viewportHeight,
                 GrDirectContext *directContext);

  // PagerCompositorDraw.cpp

  /** The resting page as draw() needs it, preferring the runtime's own paint. */
  RestingFrame restingFrameLocked() const;

  std::function<void()> _requestRedraw;
  mutable std::mutex _mutex;
  std::vector<Turn> _turns;
  std::vector<std::string> _pendingPresentedTurnIds;
  std::vector<Event> _events;
  std::vector<StockEntry> _stock;
  std::vector<PageTexture> _pageTextures;
  std::deque<PendingDirectInput> _pendingDirectInputs;
  /** The page the composer is on, including pages it turned to by itself. */
  std::string _currentPageKey;
  /** Pages the composer turned to ahead of the runtime, oldest first. */
  std::vector<std::string> _trail;
  /** The runtime's latest page, as last presented. */
  PageMaterial _presented;
  /** The page on screen at rest: the latest landed turn's target. */
  PageMaterial _resting;
  float _restingOffset = 0;
  /** The scrolling strip, shown in place of the resting page while active. */
  std::vector<StripEntry> _strip;
  bool _stripActive = false;
  float _stripOffset = 0;
  float _stripViewportHeight = 0;
  SkColor _revealColor = SK_ColorWHITE;
  uint64_t _currentPageRevision = 0;
  uint64_t _latestCompletedPageRevision = 0;
  uint64_t _stockUsageCounter = 0;
  uint64_t _stockMissCounter = 0;
  uint64_t _stockTurnCounter = 0;
  uint64_t _pageTextureUsageCounter = 0;
  uint64_t _presentedTurnCounter = 0;
  double _nextLaunchSteadyMs = 0;
  int _benchmarkRemaining = 0;
  int _benchmarkDirection = 1;
  int _preferredDirection = 1;
  double _benchmarkIntervalMs = 100;
  double _benchmarkNextSteadyMs = 0;
  bool _inputEnabled = false;
  VisualKind _visualKind = VisualKind::Curl;
  PlanarMotionTuning _planarMotionTuning;
  float _fixedChromeTop = 0;
  float _fixedChromeBottom = 0;
  MotionTuning _automaticForwardTuning = {0.72f, 1.5f, 2.2f, 6.75f};
  MotionTuning _automaticBackwardTuning = {0.72f, 1.5f, 2.2f, 6.75f};
  MotionTuning _rapidForwardTuning = {0.72f, 1.5f, 2.2f, 6.75f};
  MotionTuning _rapidBackwardTuning = {0.72f, 1.5f, 2.2f, 6.75f};
  MotionTuning _gestureForwardTuning = {0.72f, 1.35f, 2.0f, 7.0f};
  MotionTuning _gestureBackwardTuning = {0.72f, 1.35f, 2.0f, 7.0f};
};

} // namespace lunar::reader
