// Tests for the CSS generator and the settings model: every layout produces
// well-formed CSS the helper will accept, and each feature emits what Firefox needs.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { generateCss } from "../extension/shared/generate-css.js";
import { POSITIONS, REGULAR_LAYOUT, defaults, edgeZones, firefoxPrefs, isVertical, sanitize } from "../extension/shared/settings.js";

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
        for (const [toolbarAutoHide, toolbarPosition, tabsAboveToolbar] of [
          [false, "top", true],
          [true, "top", true],
          [false, "top", false],
          [true, "bottom", true],
          [false, "bottom", false],
          [true, "bottom", false],
        ]) {
          for (const extra of [
            {},
            ALL_CUSTOM,
            TOOLBAR_CUSTOM,
            { backgroundCustom: false },
            { expandedHeightAuto: false },
            { tabHeightCustom: true, shadow: true },
          ]) {
            out.push({ ...defaults(), position, autoHide, overlay, toolbarAutoHide, toolbarPosition, tabsAboveToolbar, ...extra });
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
  // Colors follow the Firefox theme until changed.
  assert.doesNotMatch(css, /#000000/);
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
    // The helper refuses stylesheets that could load other files.
    assert.doesNotMatch(css, /url\s*\(|@import/i, label);

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
  assert.match(css, /translate: 0 calc\(var\(--ahtb-toolbar-trigger\) - 100%\) !important;/);
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

test("an auto-hiding toolbar always keeps a hover strip of its own", () => {
  assert.equal(sanitize({ toolbarTriggerSize: 0 }).toolbarTriggerSize, 2);
  assert.match(generateCss({ ...defaults(), toolbarAutoHide: true, toolbarTriggerSize: 24 }), /--ahtb-toolbar-trigger: 24px;/);
});

test("release versions compare numerically", async () => {
  globalThis.browser = { runtime: { getManifest: () => ({ version: "0.1.0" }) } };
  const { compareVersions, currentVersion } = await import("../extension/shared/updates.js");
  assert.equal(currentVersion(), "0.1.0");
  assert.equal(compareVersions("0.1.10", "0.1.9"), 1);
  assert.equal(compareVersions("0.2.0", "0.10.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
});

test("top overlay clears the window controls on macOS and Windows", () => {
  const css = generateCss({ ...defaults(), position: "top" });
  assert.match(css, /@media \(-moz-platform: macos\) \{\n  [^}]*padding-inline-start: 76px !important;/);
  assert.match(css, /@media \(-moz-platform: windows\) \{\n  [^}]*padding-inline-end: 138px !important;/);
});

test("an auto-hidden toolbar opens for the Alt menu bar", () => {
  const css = generateCss({ ...defaults(), toolbarAutoHide: true });
  assert.ok(css.includes('#navigator-toolbox:has(#toolbar-menubar[autohide="true"]:not([inactive]))'));
});

test("hold rules keep every auto-hiding piece as it is while the pointer is out of sight", () => {
  const holds = (css, target) =>
    [":not(:hover)", ":has(:is(menupopup, panel):hover)", ":has(#window-modal-dialog[open])"].every((c) =>
      css.includes(`${c} ${target}`),
    );
  const vertical = generateCss({ ...defaults(), shadow: true });
  assert.ok(holds(vertical, "#sidebar-container:not([sidebar-positionend])"));
  assert.match(vertical, /min-width: calc\(var\(--ahtb-collapsed\) \+ var\(--ahtb-trigger\) \+ 0\.01px\) !important;/);
  assert.match(vertical, /margin-inline-end: calc\(-1 \* var\(--ahtb-trigger\) - 0\.01px\) !important;/);
  assert.match(vertical, /filter: drop-shadow\(0 0 0\.01px/);
  assert.match(vertical, /transition-delay: 86400s !important;/);

  const top = generateCss({ ...defaults(), position: "top", toolbarAutoHide: false });
  assert.ok(holds(top, "#TabsToolbar"));
  assert.match(top, /margin-bottom: calc\(-1 \* var\(--ahtb-trigger\) - 0\.01px\) !important;/);

  const toolbar = generateCss({ ...defaults(), toolbarAutoHide: true });
  assert.ok(holds(toolbar, "#navigator-toolbox"));
  assert.match(toolbar, /translate: 0 calc\(var\(--ahtb-toolbar-trigger\) - 100% \+ 0\.01px\) !important;/);

  const pushBottom = generateCss({ ...defaults(), position: "bottom", overlay: false });
  assert.ok(holds(pushBottom, "#browser"));
});

test("tab thickness sets Firefox's tab height for horizontal tabs only", () => {
  assert.match(generateCss({ ...defaults(), position: "top", tabHeightCustom: true, tabHeight: 24 }), /:root \{\n  --tab-min-height: 24px !important;/);
  assert.doesNotMatch(generateCss({ ...defaults(), tabHeightCustom: true, tabHeight: 24 }), /--tab-min-height/);
});

test("toolbar at the bottom moves the toolbox, flips the address bar results and asks for Firefox's title bar", () => {
  const css = generateCss({ ...defaults(), toolbarPosition: "bottom" });
  assert.match(css, /#navigator-toolbox \{\n  order: 1 !important;/);
  assert.match(css, /\.urlbarView:popover-open \{\n  position-area: block-start center !important;/);
  assert.equal(firefoxPrefs({ toolbarPosition: "bottom" })["browser.tabs.inTitlebar"], 0);
  assert.ok(!("browser.tabs.inTitlebar" in firefoxPrefs({ toolbarPosition: "top" })));

  const hidden = generateCss({ ...defaults(), toolbarPosition: "bottom", toolbarAutoHide: true });
  assert.match(hidden, /translate: 0 calc\(100% - var\(--ahtb-toolbar-trigger\)\) !important;/);
  assert.match(hidden, /border-top: var\(--ahtb-toolbar-trigger\) solid transparent !important;/);
});

test("tabs on the other edge from the toolbar are a fixed strip; on the same edge they are ordered", () => {
  const topTabsBottomBar = generateCss({ ...defaults(), position: "top", toolbarPosition: "bottom" });
  assert.match(topTabsBottomBar, /position: fixed !important;\n  inset: 0 0 auto 0 !important;/);
  assert.match(topTabsBottomBar, /#browser \{\n  margin-top: var\(--ahtb-collapsed\) !important;/);

  const wiped = generateCss({ ...defaults(), position: "top", toolbarPosition: "bottom", toolbarAutoHide: true });
  assert.match(wiped, /clip-path: inset\(100% 0 0 0\) !important;/);
  assert.match(wiped, /#navigator-toolbox::before \{[^}]*inset: auto 0 0 0 !important;/);

  const below = generateCss({ ...defaults(), position: "top", tabsAboveToolbar: false });
  assert.match(below, /#TabsToolbar \{\n  order: 10 !important;/);
  assert.match(below, /#nav-bar > \.titlebar-buttonbox-container/);
  assert.doesNotMatch(below, /-moz-platform: macos/);

  const bottomBoth = generateCss({ ...defaults(), position: "bottom", toolbarPosition: "bottom" });
  assert.match(bottomBoth, /position: relative !important;\n  margin-top: calc\(-1 \* var\(--ahtb-trigger\)\) !important;/);
  assert.doesNotMatch(bottomBoth, /position: fixed/);
});

test("the hidden toolbar's hover zone lets the pointer through to a side tab bar in use", () => {
  for (const position of ["left", "right"]) {
    for (const autoHide of [true, false]) {
      const css = generateCss({ ...defaults(), position, autoHide, toolbarAutoHide: true });
      const through = css.indexOf(":root:not([inFullscreen], [customizing]):has(#sidebar-container:hover) #navigator-toolbox");
      assert.ok(through > 0, `${position} autoHide=${autoHide}`);
      assert.ok(css.includes(":has(#tabbrowser-tabs[movingtab]) #navigator-toolbox,"));
      assert.match(css, /#navigator-toolbox \{\n  pointer-events: none !important;/);
      // The open toolbar takes the pointer back; it has to come later to win.
      const back = css.indexOf("pointer-events: auto !important;");
      assert.ok(back > through, "the open rule must follow the pass-through rule");
    }
  }
  assert.ok(!generateCss({ ...defaults(), position: "top", toolbarAutoHide: true }).includes("#sidebar-container:hover"));
  assert.ok(!generateCss(defaults()).includes("#navigator-toolbox"));
});

test("hover zones go up to 100px", () => {
  assert.equal(sanitize({ triggerSize: 100 }).triggerSize, 100);
  assert.equal(sanitize({ triggerSize: 250 }).triggerSize, 100);
  assert.equal(sanitize({ toolbarTriggerSize: 100 }).toolbarTriggerSize, 100);
  assert.equal(sanitize({ toolbarTriggerSize: 250 }).toolbarTriggerSize, 100);
  const css = generateCss({ ...defaults(), triggerSize: 80, toolbarAutoHide: true, toolbarTriggerSize: 90 });
  assert.match(css, /--ahtb-trigger: 80px;/);
  assert.match(css, /--ahtb-toolbar-trigger: 90px;/);
});

test("the regular layout is Firefox's own: top tabs, toolbar below, nothing hiding", () => {
  const custom = { ...defaults(), ...ALL_CUSTOM, triggerSize: 60, position: "right", toolbarPosition: "bottom", toolbarAutoHide: true };
  const s = sanitize({ ...custom, ...REGULAR_LAYOUT });
  // Looks and sizes stay as they were.
  assert.equal(s.backgroundOpacity, 80);
  assert.equal(s.triggerSize, 60);
  const bare = stripComments(generateCss(s));
  for (const pattern of [/#sidebar-container/, /#navigator-toolbox/, /^\s*(min|max)-height:/m, /translate|position: fixed/]) {
    assert.doesNotMatch(bare, pattern);
  }
  assert.deepEqual(firefoxPrefs(s), {
    "toolkit.legacyUserProfileCustomizations.stylesheets": true,
    "sidebar.verticalTabs": false,
  });
});


test("hover zones over the page, for the click-through page script", () => {
  assert.deepEqual(edgeZones(defaults()), [{ edge: "left", size: 10 }]);
  assert.deepEqual(edgeZones({ ...defaults(), toolbarAutoHide: true, toolbarTriggerSize: 24 }), [
    { edge: "left", size: 10 },
    { edge: "top", size: 24 },
  ]);
  assert.deepEqual(edgeZones({ ...defaults(), autoHide: false }), []);
  // A visible collapsed strip with no zone past it takes nothing from the page.
  assert.deepEqual(edgeZones({ ...defaults(), collapsedSize: 8, triggerSize: 0 }), []);
  // Tabs on the other edge from the toolbar have their own zone.
  assert.deepEqual(edgeZones({ ...defaults(), position: "bottom", toolbarAutoHide: true }), [
    { edge: "bottom", size: 10 },
    { edge: "top", size: 10 },
  ]);
  // Tabs on the toolbar's edge hide with an auto-hiding toolbar, through its zone...
  assert.deepEqual(edgeZones({ ...defaults(), position: "top", toolbarAutoHide: true, toolbarTriggerSize: 30 }), [
    { edge: "top", size: 30 },
  ]);
  // ...and next to a toolbar that stays, reach the page only from its page side.
  assert.deepEqual(edgeZones({ ...defaults(), position: "top", tabsAboveToolbar: true }), []);
  assert.deepEqual(edgeZones({ ...defaults(), position: "top", tabsAboveToolbar: false }), [{ edge: "top", size: 10 }]);
  assert.deepEqual(edgeZones({ ...defaults(), position: "bottom", toolbarPosition: "bottom", tabsAboveToolbar: true }), [
    { edge: "bottom", size: 10 },
  ]);
  assert.deepEqual(edgeZones({ ...defaults(), position: "bottom", toolbarPosition: "bottom", tabsAboveToolbar: false }), []);
});

test("pointing at something clickable near an edge lets the pointer through every hover zone", () => {
  const signal = ":has(#pageAction-urlbar-autohide-tab-bar_kits)";
  for (const s of variants()) {
    const css = generateCss(s);
    const label = `${s.position} autoHide=${s.autoHide} toolbar=${s.toolbarPosition} toolbarAutoHide=${s.toolbarAutoHide}`;
    // The page action is only a signal; its icon is never shown.
    assert.match(css, /#pageAction-urlbar-autohide-tab-bar_kits \{\n  display: none !important;/, label);
    const through = (target) => css.indexOf(`${signal} ${target} {\n  pointer-events: none !important;`);
    const tabsInToolbox = !isVertical(s.position) && s.position === s.toolbarPosition;
    if (s.autoHide && isVertical(s.position)) assert.ok(through("#sidebar-container") > 0, label);
    if (s.autoHide && !isVertical(s.position) && !(tabsInToolbox && s.toolbarAutoHide)) {
      assert.ok(through("#TabsToolbar") > 0, label);
    }
    if (s.toolbarAutoHide) {
      const wipe = !isVertical(s.position) && !tabsInToolbox;
      if (wipe) {
        assert.ok(through("#navigator-toolbox::before") > 0, label);
      } else {
        // A toolbar held open (typing, a menu) takes the pointer back.
        const zone = through("#navigator-toolbox");
        assert.ok(zone > 0, label);
        assert.ok(css.indexOf("translate: 0 0 !important;\n  pointer-events: auto !important;") > zone, label);
      }
    }
  }
});

test("every rule applies only while the add-on is installed", () => {
  const guard = '@media (-moz-pref("extensions.webextensions.ExtensionStorageIDB.migrated.autohide-tab-bar@kits")) {';
  for (const s of variants()) {
    const bare = stripComments(generateCss(s)).trim();
    assert.ok(bare.startsWith(guard), `${s.position}: something comes before the guard`);
    // The guard's block closes at the very end, so nothing follows it.
    let depth = 0;
    for (let i = 0; i < bare.length; i++) {
      if (bare[i] === "{") depth++;
      if (bare[i] === "}") depth--;
      if (depth === 0 && i > guard.length) {
        assert.equal(i, bare.length - 1, `${s.position}: a rule outside the guard`);
        break;
      }
    }
  }
});

test("bookmarks bar: Firefox's show setting, and a look of its own", () => {
  assert.equal(firefoxPrefs(defaults())["browser.toolbars.bookmarks.visibility"], undefined);
  for (const value of ["always", "newtab", "never"]) {
    assert.equal(firefoxPrefs({ ...defaults(), bookmarksVisibility: value })["browser.toolbars.bookmarks.visibility"], value);
  }
  assert.equal(sanitize({ bookmarksVisibility: "sometimes" }).bookmarksVisibility, "keep");

  assert.ok(!stripComments(generateCss(defaults())).includes("PersonalToolbar#PersonalToolbar"));
  const css = generateCss({
    ...defaults(),
    toolbarAutoHide: true,
    bookmarksBgCustom: true,
    bookmarksBgColor: "#123456",
    bookmarksTextCustom: true,
    bookmarksHeightCustom: true,
    bookmarksHeight: 30,
    bookmarksFontCustom: true,
    bookmarksFontSize: 14,
    bookmarksIconsOnly: true,
  });
  assert.match(css, /#navigator-toolbox #PersonalToolbar#PersonalToolbar \{\n  background-color: #123456 !important;/);
  // A 30px bookmark is the 16px icon plus 7px above and below.
  assert.match(css, /--bookmark-block-padding: 7px !important;/);
  assert.match(css, /toolbarbutton\.bookmark-item \{\n  height: 30px !important;\n  padding-block: 0 !important;\n  font-size: 14px !important;/);
  assert.match(css, /toolbarbutton\.bookmark-item > \.toolbarbutton-text \{\n  display: none !important;/);
  // It comes after the toolbar's look, which also reaches the bookmarks bar.
  const toolbarLook = generateCss({ ...defaults(), toolbarBgCustom: true, bookmarksBgCustom: true });
  assert.ok(toolbarLook.indexOf(":is(#nav-bar, #PersonalToolbar)") < toolbarLook.indexOf("#PersonalToolbar#PersonalToolbar"));
});
