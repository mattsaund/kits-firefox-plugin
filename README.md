# Kits Firefox Editor

Hide Firefox's tab bar and toolbar until you need them, so the page gets the
whole window. Tabs on any edge, an auto-hiding address bar, and every size,
color and speed set from a settings page inside Firefox, with a live preview.

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

Firefox doesn't let extensions restyle its own tab bar or toolbar. The helper
writes the extension's stylesheet into your profile's `userChrome.css`, so you
never edit files.

## Good to know

- Only tab icons, no titles? Click Firefox's sidebar button once.
- While applied, it decides vertical or horizontal tabs. Change the position in
  the extension, not in Firefox's settings.

## Remove

**Remove from Firefox** in the settings page, restart Firefox, then:

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
