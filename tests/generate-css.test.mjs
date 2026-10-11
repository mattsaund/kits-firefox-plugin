import { test } from "node:test";
import assert from "node:assert/strict";

import { generateCss } from "../extension/shared/generate-css.js";
import { POSITIONS, defaults, firefoxPrefs, sanitize } from "../extension/shared/settings.js";

const ALL_CUSTOM = {
  backgroundCustom: true,
  backgroundOpacity: 80,
  textCustom: true,
  selectedCustom: true,
  selectedTextCustom: true,
  hoverCustom: true,
  radiusCustom: true,
  edgeWidth: 2,
  shadow: true,
};

const TOOLBAR_CUSTOM = {
  toolbarBgCustom: true,
  toolbarIconCustom: true,
  urlbarBgCustom: true,
  urlbarTextCustom: true,
  urlbarFocusCustom: true,
  urlbarHeightCustom: true,
  urlbarRadiusCustom: true,
  urlbarFontCustom: true,
  urlbarWidthCustom: true,
};

function variants() {
  const out = [];
  for (const position of POSITIONS) {
    for (const autoHide of [true, false]) {
      for (const overlay of [true, false]) {
        for (const toolbarAutoHide of [false, true]) {
          for (const extra of [
            {},
            ALL_CUSTOM,
            TOOLBAR_CUSTOM,
            { backgroundCustom: false },
            { expandedHeightAuto: false },
          ]) {
            out.push({ ...defaults(), position, autoHide, overlay, toolbarAutoHide, ...extra });
          }
        }
      }
    }
  }
  return out;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

test("defaults reproduce the original userChrome.css values", () => {
  const css = generateCss(defaults());
  assert.match(css, /--ahtb-collapsed: 0px;/);
  assert.match(css, /--ahtb-expanded: 175px;/);
  assert.match(css, /--ahtb-trigger: 10px;/);
  assert.match(css, /--ahtb-duration: 200ms;/);
  assert.match(css, /--ahtb-easing: ease;/);
  assert.match(css, /--ahtb-close-delay: 150ms;/);
  assert.match(css, /background-color: #000000 !important;/);
  assert.match(css, /#sidebar-launcher-splitter \{\n  display: none !important;/);
  for (const id of [
    "#tabContextMenu",
    "#open-tab-group-context-menu",
    "#saved-tab-group-context-menu",
    "#sidebar-context-menu",
    "#sidebar-bookmarks-context-menu",
    "#sidebar-history-context-menu",
    "#sidebar-opentabs-context-menu",
    "#sidebar-synced-tabs-context-menu",
  ]) {
    assert.ok(css.includes(id), `missing ${id}`);
  }
  assert.ok(css.includes("#sidebar-container:not([sidebar-positionend]):has(#tabbrowser-tabs[movingtab])"));
  assert.ok(css.includes(":root:has(#tab-group-editor panel[panelopen]) #sidebar-container:not([sidebar-positionend])"));
});

test("every variant is well-formed", () => {
  for (const s of variants()) {
    const css = generateCss(s);
    const label = `${s.position} autoHide=${s.autoHide} overlay=${s.overlay}`;
    assert.doesNotMatch(css, /undefined|NaN|null|\[object/, label);

    const bare = stripComments(css);
    let depth = 0;
    for (const ch of bare) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      assert.ok(depth >= 0, `unbalanced braces in ${label}`);
    }
    assert.equal(depth, 0, `unbalanced braces in ${label}`);

    // Outside the :root variables block, every declaration must be
    // !important or Firefox's own CSS wins.
    const withoutVars = bare.replace(/^:root \{[\s\S]*?\n\}/m, "");
    for (const line of withoutVars.split("\n")) {
      const t = line.trim();
      if (!t.endsWith(";")) continue;
      assert.ok(t.endsWith("!important;"), `${label}: not !important: ${t}`);
    }
  }
});

test("right side mirrors the margins onto the start edge", () => {
  const css = generateCss({ ...defaults(), position: "right" });
  assert.ok(css.includes("#sidebar-container[sidebar-positionend] {\n  border-inline-start: var(--ahtb-trigger) solid transparent !important;"));
  assert.ok(css.includes("margin-inline-start: calc(var(--ahtb-collapsed) - var(--ahtb-expanded) - var(--ahtb-trigger))"));
});

test("push mode keeps the footprint growing instead of cancelling it", () => {
  const css = generateCss({ ...defaults(), overlay: false });
  assert.ok(!css.includes("calc(var(--ahtb-collapsed) - var(--ahtb-expanded) - var(--ahtb-trigger))"));
});

test("top: overlay clears the macOS window controls, push does not", () => {
  const overlay = generateCss({ ...defaults(), position: "top" });
  assert.match(overlay, /@media \(-moz-platform: macos\)/);
  assert.match(overlay, /margin-bottom: calc\(var\(--ahtb-collapsed\) - var\(--ahtb-expanded\)/);
  assert.match(overlay, /--ahtb-expanded: var\(--tabstrip-min-height\);/);
  assert.match(overlay, /#nav-bar > \.titlebar-buttonbox-container/);

  const push = generateCss({ ...defaults(), position: "top", overlay: false });
  assert.doesNotMatch(push, /-moz-platform: macos/);
});

test("top without auto-hide leaves the window controls where Firefox put them", () => {
  const css = generateCss({ ...defaults(), position: "top", autoHide: false });
  assert.doesNotMatch(css, /titlebar-buttonbox-container/);
});

test("bottom pins the strip to the window and reserves page space", () => {
  const css = generateCss({ ...defaults(), position: "bottom", overlay: false });
  assert.match(css, /position: fixed !important;/);
  assert.match(css, /:root:not\(\[inFullscreen\], \[customizing\]\) #navigator-toolbox \{\n  z-index: 3 !important;/);
  assert.ok(css.includes(":root:not([inFullscreen], [customizing]):has(#TabsToolbar:hover) #browser"));
  assert.match(css, /margin-bottom: var\(--ahtb-expanded\) !important;/);
});

test("theme colors emit nothing, custom colors emit variables", () => {
  const theme = generateCss({ ...defaults(), backgroundCustom: false, overlay: false });
  assert.doesNotMatch(theme, /background-color/);
  assert.doesNotMatch(theme, /--tab-background-color-selected/);

  const custom = generateCss({ ...defaults(), ...ALL_CUSTOM, backgroundColor: "#112233" });
  assert.match(custom, /background-color: rgba\(17, 34, 51, 0\.8\) !important;/);
  assert.match(custom, /--tab-background-color-selected: #42414d !important;/);
  assert.match(custom, /--tab-border-radius: 6px !important;/);
  assert.match(custom, /box-shadow: inset calc\(-1 \* 2px\) 0 0 0 #5b5b66 !important;/);
  assert.match(custom, /filter: drop-shadow\(0 0 12px/);
});

test("reduced motion block follows the setting", () => {
  assert.match(generateCss(defaults()), /prefers-reduced-motion/);
  assert.doesNotMatch(generateCss({ ...defaults(), reducedMotion: false }), /prefers-reduced-motion/);
});

test("sanitize clamps, rejects bad values and keeps the bar reachable", () => {
  const s = sanitize({
    position: "diagonal",
    expandedWidth: 99999,
    duration: "-5",
    backgroundColor: "red; } * { display: none",
    easing: "steps(2)",
    collapsedSize: 0,
    triggerSize: 0,
    extra: "dropped",
  });
  assert.equal(s.position, "left");
  assert.equal(s.expandedWidth, 600);
  assert.equal(s.duration, 0);
  assert.equal(s.backgroundColor, "#000000");
  assert.equal(s.easing, "ease");
  assert.equal(s.triggerSize, 2);
  assert.ok(!("extra" in s));
  assert.equal(sanitize({ backgroundColor: "#ABCDEF" }).backgroundColor, "#abcdef");
});

test("prefs select the tab layout and sidebar side", () => {
  assert.deepEqual(firefoxPrefs({ position: "left" }), {
    "toolkit.legacyUserProfileCustomizations.stylesheets": true,
    "sidebar.verticalTabs": true,
    "sidebar.position_start": true,
    "sidebar.visibility": "always-show",
  });
  assert.equal(firefoxPrefs({ position: "right" })["sidebar.position_start"], false);
  assert.deepEqual(firefoxPrefs({ position: "bottom" }), {
    "toolkit.legacyUserProfileCustomizations.stylesheets": true,
    "sidebar.verticalTabs": false,
  });
});

test("toolbar auto-hide slides the toolbox and keeps it open while in use", () => {
  const css = generateCss({ ...defaults(), toolbarAutoHide: true });
  assert.match(css, /translate: 0 calc\(var\(--ahtb-trigger\) - 100%\) !important;/);
  assert.ok(css.includes(":root:not([inFullscreen], [customizing]) #navigator-toolbox:hover"));
  assert.ok(css.includes("#navigator-toolbox:has(:is(#nav-bar, #PersonalToolbar, #toolbar-menubar):focus-within)"));
  assert.ok(css.includes('#navigator-toolbox:has(:is(#nav-bar, #PersonalToolbar, #toolbar-menubar) [open]:not([open="false"]))'));
  assert.doesNotMatch(generateCss(defaults()), /#navigator-toolbox/);
});

test("toolbar auto-hide with tabs on top hides them together", () => {
  const css = generateCss({ ...defaults(), position: "top", toolbarAutoHide: true });
  assert.ok(css.includes("#navigator-toolbox:has(#tabbrowser-tabs[movingtab])"));
  // The strip doesn't collapse on its own or move the window controls.
  assert.doesNotMatch(css, /#TabsToolbar \{\n  box-sizing/);
  assert.doesNotMatch(css, /titlebar-buttonbox-container/);
});

test("toolbar auto-hide with tabs at the bottom wipes the rows instead of moving the toolbox", () => {
  const css = generateCss({ ...defaults(), position: "bottom", toolbarAutoHide: true });
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // No transform on the toolbox: it would capture the fixed bottom bar.
  assert.doesNotMatch(bare, /translate:/);
  assert.ok(css.includes("#navigator-toolbox:hover:not(:has(#TabsToolbar:hover))"));
  assert.match(css, /#navigator-toolbox::before \{\n  content: "" !important;/);
  assert.match(css, /clip-path: inset\(0 0 100% 0\) !important;/);
  assert.match(css, /clip-path: inset\(0 0 0 0\) !important;/);
});

test("address bar and toolbar look", () => {
  assert.doesNotMatch(generateCss(defaults()), /#urlbar|#nav-bar, #PersonalToolbar/);
  const css = generateCss({ ...defaults(), ...TOOLBAR_CUSTOM, urlbarHeight: 40, urlbarRadius: 20, urlbarMaxWidth: 900 });
  assert.match(css, /:root \{\n  --urlbar-height: 40px !important;/);
  assert.match(css, /#urlbar \{[^}]*--urlbar-background-color: #2b2a33 !important;/);
  assert.match(css, /--urlbar-border-radius: 20px !important;/);
  assert.match(css, /#urlbar-container \{\n  max-width: 900px !important;\n  margin-inline: auto !important;/);
  assert.match(css, /:is\(#nav-bar, #PersonalToolbar\) \{\n  background-color: #1c1b22 !important;/);
});

test("address bar prefs are only written when changed from Firefox's setting", () => {
  const untouched = firefoxPrefs(defaults());
  assert.ok(!Object.keys(untouched).some((k) => k.startsWith("browser.urlbar.")));

  const prefs = firefoxPrefs({
    urlbarFullUrls: "on",
    urlbarSuggestions: "off",
    urlbarNewTab: "on",
    urlbarSearchTerms: "off",
    urlbarResults: 15,
  });
  assert.equal(prefs["browser.urlbar.trimURLs"], false);
  assert.equal(prefs["browser.urlbar.trimHttps"], false);
  assert.equal(prefs["browser.urlbar.suggest.searches"], false);
  assert.equal(prefs["browser.urlbar.openintab"], true);
  assert.equal(prefs["browser.urlbar.showSearchTerms.enabled"], false);
  assert.equal(prefs["browser.urlbar.maxRichResults"], 15);
  assert.equal(firefoxPrefs({ urlbarFullUrls: "off" })["browser.urlbar.trimURLs"], true);
});

test("an auto-hiding toolbar always keeps a hover strip", () => {
  assert.equal(sanitize({ toolbarAutoHide: true, autoHide: false, triggerSize: 0 }).triggerSize, 2);
});
