### Added

- Added a reading statistics screen with a new Statistics tab, summarizing total reading time, daily average, reading days, books, and finished books; view by week, month, year, or a custom date range, and step between periods
- Added a reading trend chart and a reading time ranking, showing reading time by day or by month; long rankings can be expanded to show the remaining books
- Added a reading calendar that shades each day by reading time, with horizontal swiping to look back; tap or long-press a day to see what was read, and continue reading directly from the statistics screen
- Added reading posters, exported from the statistics screen as cover collages for the selected period; choose from Single, Pages, and Long layouts, edit the title, add a line of your own, choose which books to show, toggle titles and authors, and shuffle the composition
- Posters support dragging and zooming covers on the canvas and ambient backgrounds; save to the photo library or share, and resume saving the remaining images if a multi-page export is interrupted; books without covers are shown by title, and posters include only the selected books, never their text
- Added a plugin system with a new Plugins tab; install `.lunar-plugin` packages by picking a file or opening one from a file manager, with requested permissions, signature status, and a trust notice shown before installation
- Added plugin repositories: add an HTTPS repository in plugin settings, confirm its signing key, then browse, install, and update plugins, with notices for available updates and incompatible SDK versions; a repository whose signing key changes is no longer fetched
- Added plugin management for enabling and disabling plugins, viewing run state and activation time, logs, plugin settings, and source details; uninstalling can optionally keep plugin data
- Plugins can be pinned to the tab bar, with up to two plugin pages shown
- Plugins can extend the reader with toolbar buttons and reader panels, draw marks over the text, read text you choose to pass to them, and import books into the library
- Added update protection for plugins: a new version replaces the old one only after it first starts successfully and is rolled back automatically on failure; plugin data is backed up before conversion and restored if conversion fails
- Added plugin safe mode, which pauses all plugins after an abnormal exit so they can be checked one by one; safe mode can also be scheduled manually for the next launch
- Added plugin developer mode for installing local packages not verified by an added repository and for live debugging through `lunar-plugin dev`; also introduced the plugin SDK and the `lunar-plugin` command-line tool for creating, building, validating, packing, and signing plugins and generating repository indexes

### Improved

- Improved lighting in the simulated page curl, with a soft shadow cast onto the page underneath and deeper shading near the spine
- Improved page-turn release detection by measuring flick speed over real time, so turns feel the same on 60 Hz and 120 Hz screens; pausing before lifting the finger now reduces the flick momentum according to the pause length
- Unified scheduling of gesture and automatic page turns, with native turns and the interface sharing the same release decision, improving handoffs during consecutive turns and when switching between turn methods
- Upgraded the reader engine to Rito RN 0.3.1, laying out more pages per background step to reduce waiting during page turns; missing or broken book images now show a placeholder icon that matches the current colors
