# Changelog

Each version is a `v` tag, with the extension and helper on its
[release page](https://github.com/mattsaund/kits-firefox-plugin/releases).

## 0.4.6 — 2026-10-15

- **The search bar's outline color is easier to find.** The setting for the
  colored ring around the address bar when you click in it is now called
  **Outline when clicked**, under Toolbar and address bar. Choose **Custom**
  and pick a color. It used to be called "Outline while typing".
- Press **Apply** after updating. No helper update needed.

## 0.4.5 — 2026-10-13

- **Fixed: bars stuck open.** Firefox's tab previews (the card that shows
  when you rest on a tab) can leave a tab marked as if a popup were open on
  it. Kits kept the bars open for that mark until Firefox restarted. A tab's
  mark no longer counts. The tab group and tab note editors still keep the
  bars open while they show.
- **The page right beside an open bar can be clicked.** The hover zone used
  to stay along the edge of an open bar and catch clicks there, like a
  button just under the toolbar. Now it gives way as the bar opens, so an
  open bar only takes the pointer on itself. A zone deeper than the bar
  keeps the rest.
- Press **Apply** after updating. No helper update needed.

## 0.4.4 — 2026-10-13

- **Passing over a link on the way to the edge no longer slows the bar
  down.** With **Let clicks through to the page** on, heading past a link or
  button for the bar (like GitHub's Projects or Wiki tabs) kept the bar shut
  for about a second. It opens right away now. Overshooting something by the
  edge, like a profile picture, still keeps the bar out of the way.
- **No more thin dark line along the top of the window** with the bars hidden
  there. It was Firefox's own line between its bars and the page. The same
  goes for the line beside a hidden side tab bar.
- The README opens with screenshots of the bars hidden and open.
- Press **Apply** after updating. No helper update needed.

## 0.4.3 — 2026-10-13

- **Fixed: the toolbar shook over the window buttons** (close, minimize,
  zoom) on macOS, making them hard to click. It stays still now.
- The close and open delays work again; 0.4.2 skipped them.
- A bar whipped open at the screen edge still opens all the way.
- Press **Apply** after updating. No helper update needed.

## 0.4.2 — 2026-10-13

- **Whipping the pointer to an edge opens the bar all the way.** Pushing
  against the screen edge counts as leaving Firefox, which used to freeze a
  bar half open. Now a bar that has started opening finishes, and one that
  has started closing finishes closing.
- Shorter README, with pictures.
- Press **Apply** after updating. No helper update needed.

## 0.4.1 — 2026-10-12

- **Put the bookmarks bar on the top or bottom**, with the toolbar or on the
  other edge.
- **Order the bars.** Where bars share an edge, stack the tab bar, toolbar
  and bookmarks bar in any order, top to bottom.
- **The bookmarks bar can auto-hide**, with its own hover zone. Bars next to
  each other that both auto-hide open together. On an auto-hiding toolbar's
  edge, bars hide along with it.
- **Reorganized settings**: Layout first (where each bar goes, and the
  order), then a section for each bar, then Opening and closing.
- A tab strip below the toolbar that auto-hides now opens. Before, its hover
  zone was clipped away.
- Press **Apply** after updating. No helper update needed.

## 0.4.0 — 2026-10-12

- **Let clicks through to the page**, a new switch under Behavior. Pointing
  at a link or button near an edge, like a site's profile picture in the top
  corner, no longer opens the bar over it. The hover zone lets the pointer
  through, even overshooting right up to the edge. Rest at the edge for a
  moment to open the bar anyway. It needs access to websites, which Firefox
  asks you for when you switch it on, only to see what's under the pointer.
  Nothing is read or sent, and switching it off gives the access back.
- **Bookmarks bar settings**: when it shows (always, on new tabs, never),
  background, text and icon color, height, text size, and icons only.
- **Removing the extension puts Firefox's look back** right away, no restart
  needed. Settings Firefox took on from Apply, like vertical tabs, stay as
  Firefox settings.
- **Reset all settings to defaults also resets the colors.** Every color now
  follows your Firefox theme until you change it. After a reset, the button
  reminds you to press Apply.
- The settings page no longer scrolls sideways when it shows an install
  command.
- **Run the install command again** to update the helper, then press
  **Apply**. The settings page reminds you.

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
