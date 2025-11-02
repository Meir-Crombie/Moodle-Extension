# Moodle JCT Redesign (Chrome Extension)

A Chrome extension that modernizes and improves the usability of `moodle.jct.ac.il` with cleaner typography, better spacing, card-style course layout, sticky header, and compact sidebar.

## Features
- Modern font, colors, spacing, and shadows
- Grid card layout for courses and blocks
- Sticky page header
- Cleaner tables and buttons
- Collapsible tall side blocks with a Show more/less toggle
- RTL aware tweaks for Hebrew
- Per-year color accents with configurable palette (Options)

## Install (Developer Mode)
1. Download this folder to your computer.
2. Generate icons (first time only):
   - Open PowerShell in the `ModdleExtension\tools` folder and run:
     ```powershell
     ./generate-icons.ps1
     ```
3. Open Chrome and go to `chrome://extensions/`.
4. Enable "Developer mode" (top right).
5. Click "Load unpacked" and select this folder (`ModdleExtension`).
6. Visit `https://moodle.jct.ac.il/` and refresh.

If the extension is already loaded, click the refresh icon on the card in `chrome://extensions/`.

## Change colors (Options)
- Right-click the extension icon → Options, or open the extension card and click "Extension options".
- Pick colors for the 8 palette slots. The course year suffix (57xx) maps to slot: `(suffix − 5700) % 8`.
- Click Save, then reload the Moodle page to see your colors.
- Click Reset to restore defaults.

## Customize further
You can tweak `styles.css` to further refine the design. Helpful targets:
- Sidebar blocks: `#block-region-side-pre .block`, `#nav-drawer`
- Course cards: `.coursebox`, `.block_myoverview .course`
- Header: `#page-header, header.navbar, .navbar`

## Uninstall
Remove the extension from `chrome://extensions/` or toggle it off.
