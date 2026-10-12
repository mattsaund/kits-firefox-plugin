# Kits Editor for Firefox

Hide Firefox's tab bar and toolbar until you need them, so the page gets the
whole window. Tabs on any edge, the address bar on the top or bottom, and
every size, color and speed of the tabs, toolbar, address bar and bookmarks
bar set from a settings page inside Firefox, with a live preview.

## Install

**1. Helper.** Needs Python 3.8+.

macOS, Linux:

```sh
curl -fsSL https://github.com/mattsaund/kits-firefox-plugin/releases/latest/download/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://github.com/mattsaund/kits-firefox-plugin/releases/latest/download/install.ps1 | iex
```

**2. Extension.** Download the `.xpi` from the
[latest release](https://github.com/mattsaund/kits-firefox-plugin/releases/latest)
and open it with Firefox.

**3. Set up.** Click the extension's toolbar button, pick your layout, press
**Apply** and restart Firefox.

It tells you when a new version is out; **Download** installs it. What changed:
[CHANGELOG](CHANGELOG.md).

## Why a helper

Kits Editor for Firefox gives you full control over Firefox's own static CSS: the
stylesheet behind the tab bar, toolbar and address bar themselves, not just
web pages. Extensions aren't allowed to touch that, and Firefox only reads it
from your profile's `userChrome.css` at startup. The helper writes the
extension's stylesheet there for you, so you never edit files.

## What Apply changes

Only when you press **Apply**: your design goes into `userChrome.css` in your
Firefox profile. Anything you or another tool put in that file before is set
aside in `userChrome.css.ahtb-backup` so it can't override the design;
**Remove from Firefox** puts it back. The Firefox settings the layout needs
(vertical or horizontal tabs, sidebar side, title bar, any address bar or
bookmarks bar options you picked) are listed on the settings page and applied
once at your next restart. After that, Firefox's own settings work as usual.

## Privacy

Nothing is collected. If you allow it (at install, in the settings page or in
`about:addons`), it asks GitHub for the latest release twice a day, so GitHub
sees your IP address and Firefox version.

With **Let clicks through to the page** on, a small script on each page checks
whether the pointer is on something clickable near an edge. It reads nothing
else and sends nothing anywhere.

## Good to know

- Only tab icons, no titles? Click Firefox's sidebar button once.
- A bar opens over a link near the edge, like a site's profile picture? Turn
  on **Let clicks through to the page** under Behavior.
- Want Firefox's regular tab bar and toolbar back? **Reset tab bar and
  toolbar** under Position, then **Apply**.

## Remove

Removing the extension switches its look off right away. To also take its
files out of your profile, press **Remove from Firefox** in the settings page
first, restart Firefox, then remove the helper:

```sh
curl -fsSL https://github.com/mattsaund/kits-firefox-plugin/releases/latest/download/install.sh | sh -s -- --uninstall
```

```powershell
& ([scriptblock]::Create((irm https://github.com/mattsaund/kits-firefox-plugin/releases/latest/download/install.ps1))) -Uninstall
```

## Contributing

**AI policy.** I am open to AI and agentic coding, but the code written needs
to follow specific guidelines:

1. MUST be human readable, acceptable variable/function names.
2. Easily traceable, following a good program flow.
3. Contributors MUST look at and document code and code changes. You need to
   understand the code that is being written.

**Tests.** `npm test` and `npm run lint`. A version is released by tagging it;
see `.github/workflows/release.yml`.

## License and credits

Created by Matthew Saunders (https://msaunders.dev) and Austin Laubach
(https://github.com/cli-geek).

MIT. See [LICENSE](LICENSE).
