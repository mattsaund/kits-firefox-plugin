# Changelog

Each version is a `v` tag, with the extension and helper on its
[release page](https://github.com/mattsaund/kits-firefox-plugin/releases).

## 0.2.0 — 2026-10-11

- **Windows.** A PowerShell one-liner installs the helper and registers it
  with Firefox; `-Uninstall` removes it. The helper finds your Firefox
  profiles and tells which one is running.
- With the tab bar sliding over the toolbar at the top, it now stays clear of
  the Windows minimize, maximize and close buttons.
- An auto-hidden toolbar opens while the Alt menu bar is showing.
- The settings page shows the right install command and quit shortcut for
  your system.
- After updating the extension, run the install command again to update the
  helper. The settings page reminds you.

## 0.1.0 — 2026-10-11

First release.

- **Tab bar on any edge.** Left, right, top or bottom. It hides until the
  pointer reaches that edge, then slides over the page or pushes it aside.
- **Auto-hiding toolbar.** The address bar row can hide too, so the page gets
  the whole window. It comes back at the top edge, or when you press ⌘L / Ctrl+L.
- **Settings in Firefox, with a live preview.** Size, colors, animation speed
  and style, open and close delays, hover zone, edge line, shadow.
- **Address bar.** Color, height, corners, text size, width, plus full
  addresses, suggestions, results in a new tab, search terms and result count.
- **One-line helper install.** The helper writes the stylesheet into your
  Firefox profile, so you never edit files by hand.
- **Update check.** You get a popup with a download button when a new version
  is out.
