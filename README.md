# Auto-Hide Tab Bar

A Firefox extension that turns the tab bar into an auto-hiding strip on any
edge of the window: **left, right, top or bottom**. It stays out of the way
until the pointer reaches that edge, then slides open over the page (or pushes
the page aside, if you prefer).

Everything is set from a settings page inside Firefox, with a live preview:

- **Position**: left or right (Firefox's vertical tabs), top or bottom (horizontal tabs)
- **Size**: open width or height, how much stays visible when closed, size of the invisible hover zone
- **Behavior**: auto-hide on or off, slide over vs. push the page, animation length and style, open and close delays, respect for the system "reduce motion" setting
- **Look**: background color and opacity, text, selected tab, hovered tab, tab corner radius, an edge line, a shadow when open. Any of these can stay on "Theme" to follow your Firefox theme.

## Why there's a helper program

Firefox doesn't let extensions restyle its own interface. Since Firefox 57,
add-ons can only change web pages and their own panels. The one supported way
to restyle the tab bar is a `userChrome.css` file in your Firefox profile.
Every auto-hide sidebar setup relies on this, including popular ones like
Sidebery and Tree Style Tab.

So this project has two parts:

| Part | What it does |
| --- | --- |
| `extension/` | The settings page and live preview. It turns your settings into a stylesheet. |
| `native-host/` | A small Python helper. Firefox starts it on the extension's behalf to write that stylesheet into your profile. |

You install the helper once and never edit files by hand. Because Firefox only
reads `userChrome.css` at startup, **changes take effect after you restart
Firefox**. The settings page tells you when a restart is needed.

## Install

Requirements: Firefox 155 or newer, macOS or Linux, Python 3.8+ (built into
macOS with the Xcode command line tools).

1. **Install the helper.** From this folder:

   ```sh
   ./native-host/install.sh
   ```

   It copies the helper to `~/Library/Application Support/AutoHideTabBar/` on
   macOS (`~/.local/share/autohide-tab-bar/` on Linux) and registers it with
   Firefox. After that you can move or delete this folder without breaking it.

2. **Install the extension.** Pick one:

   - **Try it now (temporary):** open `about:debugging#/runtime/this-firefox`,
     click **Load Temporary Add-on…** and choose `extension/manifest.json`.
     Firefox removes temporary add-ons when it quits. The styling you applied
     stays, but you'd need to load the add-on again to change settings.
   - **Keep it installed:** regular Firefox only installs signed add-ons.
     Signing for your own use is free and automatic. Create API keys at
     [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/developers/addon/api/key/), then:

     ```sh
     npm install
     WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... npm run sign
     ```

     Open the `.xpi` it saves in `dist/` with Firefox to install it.

3. **Apply.** The settings page opens on install, or click the extension's
   toolbar button. Adjust things in the preview, press **Apply**, then quit and
   reopen Firefox.

## What it changes

Everything lives in your Firefox profile folder (`about:support` → **Profile
Folder**):

| File | Change |
| --- | --- |
| `chrome/autohide-tab-bar.css` | The generated stylesheet. Replaced on every Apply. |
| `chrome/userChrome.css` | One managed `@import` line at the top. Anything else in the file is left alone, and the original is backed up once as `userChrome.css.ahtb-backup`. |
| `user.js` | A managed block of prefs: turns on `toolkit.legacyUserProfileCustomizations.stylesheets`, chooses vertical or horizontal tabs, and, for left/right, the sidebar side and `sidebar.visibility = always-show`. |

**Remove from Firefox** on the settings page takes all of that back out, then
restart Firefox. To remove the helper itself, run `./native-host/uninstall.sh`.

## Good to know

- **Only icons in the side bar, no titles?** Firefox keeps its own
  expanded/collapsed mode for the sidebar and restores it from your last
  session. Click Firefox's sidebar button (left end of the toolbar) once to
  switch it to full width. Firefox remembers this.
- **The extension controls the tab layout.** While it's applied, the prefs in
  `user.js` are reapplied at every startup. If you switch between vertical and
  horizontal tabs in Firefox's own settings, it switches back when Firefox
  restarts. Change the position in this extension instead.
- **Top and bottom** use horizontal tabs. On macOS the window buttons move
  into the toolbar (where Firefox puts them for vertical tabs), so they stay
  reachable while the tab bar is hidden.
- The tab bar keeps working normally in fullscreen and in Customize mode,
  where the auto-hide rules switch off.
- Windows isn't supported yet. The helper's installer covers macOS and Linux.
  Contributions welcome.

## Development

```sh
npm install
npm test        # CSS generator (node:test) and helper (unittest)
npm run lint    # Mozilla's add-on linter
npm start       # launches Firefox with the extension loaded
npm run build   # unsigned .zip in dist/
```

Layout:

```
extension/
  manifest.json
  background.js            toolbar button and first-run open the settings page
  shared/settings.js       settings model, defaults, validation, Firefox prefs
  shared/generate-css.js   settings → userChrome stylesheet
  options/                 settings page and live preview
native-host/
  autohide_tab_bar_host.py the helper (stdlib only)
  install.sh, uninstall.sh
tests/
userChrome.css             the original hand-written stylesheet this grew from
```

The generator's selectors were checked against Firefox 157's own markup and
CSS. If a Firefox update moves things around, `extension/shared/generate-css.js`
is the one place to fix.

## Credits

Made by Matthew Saunders and [Austin Laubach](https://github.com/cli-geek).

## License

[MIT](LICENSE)
