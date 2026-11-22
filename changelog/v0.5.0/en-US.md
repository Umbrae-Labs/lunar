### Added

- Added a vertical scroll reading mode, switchable between Turn pages and Scroll in the typography panel; reading position is recorded when scrolling settles, and long-pressing selects text for highlights and notes
- Added a "Follow system brightness" option in both the reader appearance panel and reading settings; when turned off, the reader uses the brightness set in reader appearance
- Added plugin download management, accessible from plugin management and Downloads in settings, showing covers and progress with pause, resume, automatic and manual retry, record removal, and direct reading when finished; plugins can package downloaded content as EPUBs and import them into the library automatically
- Added a floating plugin shortcut button in the reader so plugins can register quick actions, running directly for a single entry or opening a menu for multiple entries; drag it to snap to either side edge, with its position saved and automatically kept clear of reader controls and system bars
- Added plugin key management in plugin details to configure a public HTTPS service address and secret; keys are stored encrypted on the device, sent only to the configured address, and never readable by plugins
- Added streaming network responses for plugins and a CommonMark `Markdown` UI component that blocks remote images and opens links in the system browser only when tapped
- Renamed the plugin SDK and CLI to `@umbrae-labs/lunar-plugin-sdk` and `@umbrae-labs/lunar-plugin-cli` and updated them to 0.1.6 while keeping host compatibility with previously installed plugins using the old module name

### Improved

- Upgraded the reader engine to Rito RN 0.4.0, reusing the open reader session to reflow in place when changing typography settings instead of reopening the book; also added OpenType font feature support for better rendering of vertical and combined glyphs
- Improved page-turn responsiveness and prefetching by handling edge taps directly on the UI thread while respecting links, footnotes, images, and highlights, and by prefetching neighbors along the travel direction with multi-direction page buffering for smoother consecutive and back-and-forth turns
- Improved single-page simulated curl rendering so bookmarked pages display a mirrored bookmark ribbon on the reverse side as the page curls
- Improved the reader loading transition with a monochrome lunar-phase overlay rendered directly on the active paper color, honoring the system reduced-motion setting
- Improved EPUB import, inspection, and packaging with streaming per-entry ZIP I/O instead of inflating entire archives into memory, reducing peak memory usage for large books
- Refined navigation and UI visuals: added frosted translucent backgrounds to the bottom navigation bar and reader controls, synced the system root background color with the active theme to reduce edge flashes during transitions, unified app icons with Lucide, and standardized toggle switches and search fields
- Streamlined the plugin list interaction so tapping opens a plugin's page or settings directly instead of relying on long-press actions
- Simplified reading statistics duration formatting to display minutes without seconds for durations under an hour

### Fixed

- Fixed an issue where some Android file managers could not select `.lunar-plugin` packages due to MIME type filtering (#16, by @SXP-Simon)
- Fixed a race condition when closing an active native reader session during rapid exit or book switching so teardown waits for an in-progress close to finish (#13, by @SXP-Simon)
- Fixed a missing background color on the library back-to-top button
- Fixed plugin `Button` icon colors not following the button variant theme color, and fixed plugin layout styling when optional gap or padding props are omitted
- Fixed `lunar-plugin --help` and `-h` being rejected as unknown commands
