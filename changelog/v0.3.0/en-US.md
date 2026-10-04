### Added

- Added excerpt cards made from selected text, with options to save images to the photo library or share them; choose from Classic, Calendar, and Letter templates, customize backgrounds and fonts, and retain template preferences
- Added a reader appearance panel with screen brightness controls; leaving the reader restores system brightness settings or the brightness used before entering the reader
- Added five paper color palettes with separate preferences for light and dark themes and matching text colors

### Improved

- Replaced the cover page transition with a no-animation option and automatically migrated existing cover settings; slide and simulated page curl remain available
- Improved page-turn gesture responsiveness and page handoffs for more continuous visuals during consecutive turns, reverse drags, and snap-back animations
- Improved reading progress and brightness sliders with better drag feedback, value precision, and boundary handling
- Improved excerpt and note quotation formatting by joining visual line breaks within paragraphs, preserving paragraph spacing, and removing excess spaces between Chinese characters
- Switched the reader engine to the separately published Rito RN 0.2.2 package, using bundled precompiled libraries for Android builds to reduce local native build setup

### Fixed

- Fixed navigation for some table-of-contents entries and internal EPUB links, improving anchor positioning, encoded URL handling, and chapter file matching
- Fixed missing or inaccurate multi-line highlights, improving source text matching for selections across paragraphs and restoration of saved marks
- Fixed bookmark detection on some pages and improved bookmark rendering during page turns
- Fixed errors caused by missing resource disposal methods on some native Skia drawing objects
