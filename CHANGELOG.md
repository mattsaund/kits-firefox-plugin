# Changelog

Each version is a `v` tag, with the extension and helper on its
[release page](https://github.com/mattsaund/kits-firefox-plugin/releases).

## 0.3.5 — 2026-10-12

- **Old userChrome.css edits no longer get in the way.** Anything else in
  `userChrome.css`, like a hand-written auto-hide sidebar from before, used
  to load after Kits and override it. That made the tab bar push the page
  aside for a moment as it opened, even when set to slide over it. Apply now
  sets those rules aside in `userChrome.css.ahtb-backup`, and **Remove from
  Firefox** puts them back. The settings page tells you when there are some
  to set aside.
- **The top of a side tab bar is reachable with an auto-hiding toolbar.**
  The hidden toolbar's hover zone covered the first tabs, so pointing at
  them opened the toolbar over them and closed the tab bar. While you're on
  the tab bar, the zone now lets the pointer through. The toolbar still
  opens from the rest of the edge.
- **Hover zones up to 100px**, for the tab bar and the toolbar (was 40px).
- **Reset tab bar and toolbar**, under Position: back to Firefox's regular
  layout, with tabs along the top above the toolbar and neither hiding.
  Colors and sizes stay.
- Linux: the helper finds Firefox profiles in `~/.config/mozilla/firefox`,
  where newer Firefox keeps them.
- **Run the install command again** to update the helper; the settings page
  reminds you. Then press Apply.

## 0.3.2 — 2026-10-11

- **The update Download button installs the update.** It used to open an
  empty tab that Firefox never installed from, which looks like a black
  screen with the bars hidden. Now Firefox asks to allow the install, then to
  add the update, and you stay where you were.
- **The settings page scrolls to the bottom from anywhere.** Scrolling over
  the preview column no longer gets stuck. Updates, manual install and reset
  moved below the settings.
- **Check now** shows a new version on the settings page only, without the
  popup window.
- The icon's arrow points right: `˙>˙`.
- Coming from 0.3.1 or earlier: that version's Download button still opens
  the empty tab. Instead, click the `.xpi` file on this release page.

## 0.3.1 — 2026-10-11

- **New icon:** a yellow-orange `.>.` turned upside down, on the toolbar
  button and everywhere else.
- No new helper needed: the settings page only asks for a helper update
  when a release changes it.

## 0.3.0 — 2026-10-11

- **Bars stay put when the pointer leaves Firefox's sight.** Pushing against
  the screen edge, opening a right-click menu, reaching for the window
  buttons or opening Edit Bookmark no longer closes the tab bar or toolbar.
  They close once the pointer is back over the page.
- **Toolbar on the top or bottom.** At the bottom the address bar's results
  open upward, and Firefox's own title bar keeps the window buttons at the
  top.
- **Tabs above or below the toolbar** when both are on the same edge.
- **The toolbar has its own hover zone.**
- **Tab thickness** for tabs on the top or bottom.
- **Firefox settings apply once.** The settings Apply needs take effect at the
  next restart and then stop being forced, so changes made in Firefox's own
  settings stick.
- **Clear about what Apply changes.** The settings page lists every Firefox
  setting Apply will change, before you press it.
- **Update checks need your consent.** They use Firefox's built-in "technical
  and interaction data" choice (at install, in the settings page or in
  about:addons) and are skipped without it.
- The helper refuses stylesheets that could load other files.

## 0.2.1 — 2026-10-11

- **Signed by Mozilla**, so regular Firefox installs it permanently.
- Renamed to **Kits Editor for Firefox**: Mozilla only allows "Firefox" in
  an add-on's name as "… for Firefox".

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
