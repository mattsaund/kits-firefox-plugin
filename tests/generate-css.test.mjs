// Tests for the CSS generator and the settings model: every layout produces
// well-formed CSS the helper will accept, and each feature emits what Firefox needs.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { generateCss } from "../extension/shared/generate-css.js";
import {
  POSITIONS,
  REGULAR_LAYOUT,
  barLayout,
  defaults,
  edgeZones,
  firefoxPrefs,
  isVertical,
  sanitize,
} from "../extension/shared/settings.js";

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
        for (const [toolbarAutoHide, toolbarPosition, barOrder] of [
          [false, "top", "tabs,toolbar,bookmarks"],
          [true, "top", "tabs,toolbar,bookmarks"],
          [false, "top", "toolbar,bookmarks,tabs"],
          [true, "bottom", "tabs,toolbar,bookmarks"],
          [false, "bottom", "bookmarks,tabs,toolbar"],
          [true, "bottom", "toolbar,tabs,bookmarks"],
        ]) {
          for (const extra of [
            {},
            ALL_CUSTOM,
            TOOLBAR_CUSTOM,
            { backgroundCustom: false },
            { expandedHeightAuto: false },
            { tabHeightCustom: true, shadow: true },
          ]) {
            for (const bookmarks of [
              { bookmarksPosition: toolbarPosition },
              { bookmarksPosition: toolbarPosition === "top" ? "bottom" : "top" },
              { bookmarksPosition: toolbarPosition, bookmarksAutoHide: true },
              { bookmarksPosition: toolbarPosition === "top" ? "bottom" : "top", bookmarksAutoHide: true },
            ]) {
              out.push({ ...defaults(), position, autoHide, overlay, toolbarAutoHide, toolbarPosition, barOrder, ...bookmarks, ...extra });
            }
          }
        }
      }
    }
  }
  return out;
}

const OPENNESS = "max(var(--ahtb-open), var(--ahtb-reopen))";
const SIDE_GROWTH = "var(--ahtb-expanded) - var(--ahtb-collapsed)";

/** A hover zone that gives way as its bar opens (zoneDepth in generate-css.js). */
function zone(size, growth) {
  return `calc(${size} - ${OPENNESS} * clamp(0px, ${growth}, ${size}))`;
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
  assert.ok(css.includes(":root:has(:is(#tab-group-editor, #tab-note-menu) panel[panelopen]) #sidebar-container:not([sidebar-positionend])"));
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
    const withoutVars = bare.replace(/^:root \{[\s\S]*?\n\}/m, "").replace(/^@property [^\n]*\{[\s\S]*?\n\}/gm, "");
    for (const line of withoutVars.split("\n")) {
      const t = line.trim();
      if (!t.endsWith(";")) continue;
      assert.ok(t.endsWith("!important;"), `${label}: not !important: ${t}`);
    }
  }
});

test("right side mirrors the margins onto the start edge", () => {
  const css = generateCss({ ...defaults(), position: "right" });
  assert.ok(css.includes(`#sidebar-container[sidebar-positionend] {\n  border-inline-start: ${zone("var(--ahtb-trigger)", SIDE_GROWTH)} solid transparent !important;`));
  assert.ok(css.includes(`margin-inline-start: calc(-1 * ${zone("var(--ahtb-trigger)", SIDE_GROWTH)} - ${OPENNESS} * (${SIDE_GROWTH}))`));
});

test("push mode keeps the footprint growing instead of cancelling it", () => {
  const css = generateCss({ ...defaults(), overlay: false });
  assert.ok(!css.includes("calc(var(--ahtb-collapsed) - var(--ahtb-expanded) - var(--ahtb-trigger))"));
});

test("top: overlay clears the macOS window controls, push does not", () => {
  const overlay = generateCss({ ...defaults(), position: "top" });
  assert.match(overlay, /@media \(-moz-platform: macos\)/);
  assert.ok(overlay.includes(`margin-bottom: calc(-1 * ${zone("var(--ahtb-trigger)", SIDE_GROWTH)} - ${OPENNESS} * (${SIDE_GROWTH}))`));
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
  // Pushing, the page's margin follows the strip's open state.
  assert.ok(css.includes("margin-bottom: calc(var(--ahtb-collapsed) + max(var(--ahtb-open), var(--ahtb-reopen)) * (var(--ahtb-expanded) - var(--ahtb-collapsed)))"));
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
  assert.ok(custom.includes("filter: drop-shadow(0 0 calc(12px * max(var(--ahtb-open), var(--ahtb-reopen))) rgba(0, 0, 0, calc(0.45 * max(var(--ahtb-open), var(--ahtb-reopen)))))"));
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
  assert.ok(css.includes("translate: 0 calc((1 - max(var(--ahtb-open), var(--ahtb-reopen))) * calc(var(--ahtb-toolbar-trigger) - 100%))"));
  assert.ok(css.includes(":root:not([inFullscreen], [customizing]) #navigator-toolbox:hover"));
  assert.ok(css.includes("#navigator-toolbox:has(:is(#nav-bar, #PersonalToolbar, #toolbar-menubar):focus-within)"));
  assert.ok(css.includes('#navigator-toolbox:has(:is(#nav-bar, #PersonalToolbar, #toolbar-menubar) [open]:not([open="false"], #tabbrowser-tabs *))'));
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
  // The rows open and close themselves, on the toolbox's conditions.
  assert.ok(css.includes("clip-path: inset(0 0 calc((1 - max(var(--ahtb-open), var(--ahtb-reopen))) * 100%) 0) !important;\n  pointer-events: none !important;\n  --ahtb-open: 0 !important;"));
  assert.ok(css.includes("#navigator-toolbox:hover:not(:has(#TabsToolbar:hover)) > :is(#nav-bar, #PersonalToolbar, #toolbar-menubar)"));
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
  // Out of sight, --ahtb-open heads for open (an opening bar carries on) and
  // --ahtb-reopen for a value it never has; both a day away.
  const held = "--ahtb-open: 1 !important;\n  --ahtb-reopen: 0.5 !important;\n  transition-delay: 86400s !important;";
  const vertical = generateCss({ ...defaults(), shadow: true });
  assert.ok(holds(vertical, "#sidebar-container:not([sidebar-positionend])"));
  assert.ok(vertical.includes(held));
  // The sizes follow the openness every frame; only the openness transitions.
  assert.ok(vertical.includes(`min-width: calc(var(--ahtb-collapsed) + ${zone("var(--ahtb-trigger)", SIDE_GROWTH)} + ${OPENNESS} * (${SIDE_GROWTH}))`));
  assert.match(vertical, /transition-property: --ahtb-open, --ahtb-reopen !important;\n  transition-duration: var\(--ahtb-duration\) !important;/);
  assert.match(vertical, /transition-delay: var\(--ahtb-close-delay\) !important;/);
  assert.match(vertical, /--ahtb-open: 1 !important;\n  --ahtb-reopen: 1 !important;\n  transition-delay: var\(--ahtb-open-delay\) !important;/);
  assert.doesNotMatch(stripComments(vertical), /transition-property: [^;]*(width|translate|margin|filter)/);

  const top = generateCss({ ...defaults(), position: "top", toolbarAutoHide: false });
  assert.ok(holds(top, "#TabsToolbar"));
  assert.ok(top.includes(held));

  const toolbar = generateCss({ ...defaults(), toolbarAutoHide: true });
  assert.ok(holds(toolbar, "#navigator-toolbox"));

  const pushBottom = generateCss({ ...defaults(), position: "bottom", overlay: false });
  assert.ok(holds(pushBottom, "#browser"));
  // Both registered, not inherited, ahead of the guard.
  for (const name of ["--ahtb-open", "--ahtb-reopen"]) {
    assert.ok(vertical.includes(`@property ${name} {\n  syntax: "<number>";\n  inherits: false;\n  initial-value: 0;\n}`));
  }
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

  const hidden = generateCss({ ...defaults(), toolbarPosition: "bottom", bookmarksPosition: "bottom", toolbarAutoHide: true });
  assert.ok(hidden.includes("translate: 0 calc((1 - max(var(--ahtb-open), var(--ahtb-reopen))) * calc(100% - var(--ahtb-toolbar-trigger)))"));
  assert.match(hidden, /border-top: var\(--ahtb-toolbar-trigger\) solid transparent !important;/);
});

test("tabs on the other edge from the toolbar are a fixed strip; on the same edge they are ordered", () => {
  const topTabsBottomBar = generateCss({ ...defaults(), position: "top", toolbarPosition: "bottom", bookmarksPosition: "bottom" });
  assert.match(topTabsBottomBar, /#TabsToolbar \{\n  position: fixed !important;\n  inset-inline: 0 !important;\n  bottom: auto !important;\n  top: 0px !important;/);
  assert.match(topTabsBottomBar, /#browser \{\n  margin-top: var\(--ahtb-collapsed\) !important;/);

  const wiped = generateCss({ ...defaults(), position: "top", toolbarPosition: "bottom", bookmarksPosition: "bottom", toolbarAutoHide: true });
  assert.ok(wiped.includes("clip-path: inset(calc((1 - max(var(--ahtb-open), var(--ahtb-reopen))) * 100%) 0 0 0)"));
  assert.match(wiped, /#navigator-toolbox::before \{[^}]*inset: auto 0 0 0 !important;/);

  // Saved before 0.4.1 as "tabs below the toolbar".
  const below = generateCss({ ...defaults(), position: "top", tabsAboveToolbar: false, barOrder: undefined });
  assert.match(below, /#nav-bar \{\n  order: 1 !important;/);
  assert.match(below, /#PersonalToolbar \{\n  order: 2 !important;/);
  assert.match(below, /#TabsToolbar \{\n  order: 3 !important;/);
  assert.match(below, /#notifications-toolbar \{\n  order: 4 !important;/);
  assert.match(below, /#nav-bar > \.titlebar-buttonbox-container/);
  assert.doesNotMatch(below, /-moz-platform: macos/);
  // Firefox's own order needs no rules.
  assert.doesNotMatch(generateCss({ ...defaults(), position: "top" }), /order: /);

  const bottomBoth = generateCss({ ...defaults(), position: "bottom", toolbarPosition: "bottom", bookmarksPosition: "bottom" });
  assert.match(bottomBoth, /position: relative !important;\n  z-index: 10 !important;/);
  assert.ok(bottomBoth.includes(`margin-top: calc(-1 * ${zone("var(--ahtb-trigger)", SIDE_GROWTH)} - ${OPENNESS} * (${SIDE_GROWTH})) !important;`));
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
    { edge: "top", size: 10 },
    { edge: "bottom", size: 10 },
  ]);
  // Tabs on the toolbar's edge hide with an auto-hiding toolbar, through its zone...
  assert.deepEqual(edgeZones({ ...defaults(), position: "top", toolbarAutoHide: true, toolbarTriggerSize: 30 }), [
    { edge: "top", size: 30 },
  ]);
  // ...and next to a toolbar that stays, reach the page only from its page side.
  assert.deepEqual(edgeZones({ ...defaults(), position: "top", barOrder: "tabs,toolbar,bookmarks" }), []);
  assert.deepEqual(edgeZones({ ...defaults(), position: "top", barOrder: "toolbar,bookmarks,tabs" }), [{ edge: "top", size: 10 }]);
  const bottomBoth = { ...defaults(), position: "bottom", toolbarPosition: "bottom", bookmarksPosition: "bottom" };
  assert.deepEqual(edgeZones({ ...bottomBoth, barOrder: "tabs,toolbar,bookmarks" }), [{ edge: "bottom", size: 10 }]);
  assert.deepEqual(edgeZones({ ...bottomBoth, barOrder: "toolbar,bookmarks,tabs" }), []);
  // A bookmarks bar that hides on its own and meets the page.
  assert.deepEqual(edgeZones({ ...defaults(), bookmarksAutoHide: true, bookmarksTriggerSize: 14 }), [
    { edge: "left", size: 10 },
    { edge: "top", size: 14 },
  ]);
});

test("pointing at something clickable near an edge lets the pointer through every hover zone", () => {
  const signal = ":has(#pageAction-urlbar-autohide-tab-bar_kits)";
  for (const s of variants()) {
    const css = generateCss(s);
    const L = barLayout(s);
    const label = `${s.position} autoHide=${s.autoHide} toolbar=${s.toolbarPosition} toolbarAutoHide=${s.toolbarAutoHide} bookmarks=${s.bookmarksPosition}`;
    // The page action is only a signal; its icon is never shown.
    assert.match(css, /#pageAction-urlbar-autohide-tab-bar_kits \{\n  display: none !important;/, label);
    const through = (target) => css.indexOf(`${signal} ${target} {\n  pointer-events: none !important;`);
    if (s.autoHide && isVertical(s.position)) assert.ok(through("#sidebar-container") > 0, label);
    if (L.hiding.tabs === "own") assert.ok(through("#TabsToolbar") > 0, label);
    if (L.hiding.bookmarks === "own") assert.ok(through("#PersonalToolbar") > 0, label);
    if (s.toolbarAutoHide) {
      if (L.fixed.length) {
        assert.ok(through("#navigator-toolbox::before") > 0, label);
      } else {
        // A toolbar held open (typing, a menu) takes the pointer back.
        const zone = through("#navigator-toolbox");
        assert.ok(zone > 0, label);
        const back = css.indexOf("transition-delay: var(--ahtb-open-delay) !important;\n  pointer-events: auto !important;");
        assert.ok(back > zone, label);
      }
    }
  }
});

test("every rule applies only while the add-on is installed", () => {
  const guard = '@media (-moz-pref("extensions.webextensions.ExtensionStorageIDB.migrated.autohide-tab-bar@kits")) {';
  for (const s of variants()) {
    // Registering the open state styles nothing; it goes ahead of the guard.
    const bare = stripComments(generateCss(s)).trim().replace(/^(@property [^{]*\{[^}]*\}\s*)+/, "");
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

test("bar order and placement: saved settings from before 0.4.1 keep their layout", () => {
  // Tabs below the toolbar, and a bookmarks bar that sat with a bottom toolbar.
  assert.equal(sanitize({ tabsAboveToolbar: false }).barOrder, "toolbar,bookmarks,tabs");
  assert.equal(sanitize({ tabsAboveToolbar: true }).barOrder, "tabs,toolbar,bookmarks");
  assert.equal(sanitize({ toolbarPosition: "bottom" }).bookmarksPosition, "bottom");
  assert.equal(sanitize({ toolbarPosition: "bottom", bookmarksPosition: "top" }).bookmarksPosition, "top");
  assert.equal(sanitize({ barOrder: "tabs,tabs,toolbar" }).barOrder, "tabs,toolbar,bookmarks");
  // Reset layout puts every bar back where Firefox has it.
  const reset = sanitize({ ...defaults(), position: "left", bookmarksPosition: "bottom", bookmarksAutoHide: true, barOrder: "bookmarks,toolbar,tabs", ...REGULAR_LAYOUT });
  assert.deepEqual(barLayout(reset).stacks, { top: ["tabs", "toolbar", "bookmarks"], bottom: [] });
});

test("bars on an edge stack in order; neighbours that both hide form one group", () => {
  const L = barLayout({ ...defaults(), position: "bottom", bookmarksPosition: "bottom", bookmarksAutoHide: true, barOrder: "toolbar,tabs,bookmarks" });
  // Window edge first: at the bottom the order is read upward.
  assert.deepEqual(L.stacks, { top: ["toolbar"], bottom: ["bookmarks", "tabs"] });
  assert.deepEqual(L.groups.tabs, ["bookmarks", "tabs"]);
  // A toolbar that stays splits them up.
  const split = barLayout({ ...defaults(), position: "top", bookmarksAutoHide: true, barOrder: "tabs,toolbar,bookmarks" });
  assert.deepEqual(split.groups, { tabs: ["tabs"], bookmarks: ["bookmarks"] });
  // An auto-hiding toolbar takes the bars on its edge with it.
  const along = barLayout({ ...defaults(), position: "top", toolbarAutoHide: true, bookmarksAutoHide: true });
  assert.deepEqual(along.hiding, { tabs: "toolbar", toolbar: "own", bookmarks: "toolbar" });
});

test("bookmarks bar hiding in the toolbox reaches out of it", () => {
  const css = generateCss({ ...defaults(), bookmarksAutoHide: true });
  // Out of the toolbox's clip and above the page.
  assert.match(css, /#navigator-toolbox \{\n  z-index: 3 !important;\n  overflow: visible !important;/);
  assert.ok(css.includes(`#PersonalToolbar {\n  box-sizing: border-box !important;\n  min-height: calc(0px + ${zone("var(--ahtb-bm-trigger)", "var(--ahtb-bm-height) - 0px")} + ${OPENNESS} * (var(--ahtb-bm-height) - 0px)) !important;`));
  assert.ok(css.includes(`border-bottom: ${zone("var(--ahtb-bm-trigger)", "var(--ahtb-bm-height) - 0px")} solid transparent !important;`));
  // Sliding open over the page, which stays put.
  assert.ok(css.includes(`margin-bottom: calc(-1 * ${zone("var(--ahtb-bm-trigger)", "var(--ahtb-bm-height) - 0px")} - ${OPENNESS} * (var(--ahtb-bm-height) - 0px)) !important;`));
  assert.ok(css.includes(':has(#PersonalToolbar [open]:not([open="false"])) #PersonalToolbar'));
  assert.ok(css.includes(":has(#placesContext :is(menu, menuitem)[_moz-menuactive]) #PersonalToolbar"));
  // Its size, or nothing while Firefox hides the bar.
  assert.match(css, /--ahtb-bm-height: 28px;/);
  assert.match(css, /:root:has\(#PersonalToolbar\[collapsed\]:not\(\[collapsed="false"\]\)\) \{\n  --ahtb-bm-height: 0px !important;/);
  assert.match(generateCss({ ...defaults(), bookmarksHeightCustom: true, bookmarksHeight: 30 }), /--ahtb-bm-height: 34px;/);
});

test("bars on the other edge are fixed strips, stacked, with the page kept clear", () => {
  const one = generateCss({ ...defaults(), bookmarksPosition: "bottom" });
  assert.match(one, /#PersonalToolbar \{\n  position: fixed !important;\n  inset-inline: 0 !important;\n  top: auto !important;\n  bottom: 0px !important;/);
  assert.match(one, /#browser \{\n  margin-bottom: var\(--ahtb-bm-height\) !important;/);

  // Tabs outermost and always open, the bookmarks bar inside them, hiding.
  const stacked = generateCss({ ...defaults(), position: "bottom", autoHide: false, bookmarksPosition: "bottom", bookmarksAutoHide: true, barOrder: "toolbar,bookmarks,tabs" });
  assert.match(stacked, /#PersonalToolbar \{\n  position: fixed !important;\n  inset-inline: 0 !important;\n  top: auto !important;\n  bottom: var\(--ahtb-expanded\) !important;/);
  assert.match(stacked, /#browser \{\n  margin-bottom: var\(--ahtb-expanded\) !important;/);

  // Both hiding: one group; the inner bar moves out as the outer one opens.
  const group = generateCss({ ...defaults(), position: "bottom", bookmarksPosition: "bottom", bookmarksAutoHide: true, barOrder: "toolbar,tabs,bookmarks" });
  // The bookmarks bar at the window's edge, the tab strip inside it.
  assert.match(group, /#PersonalToolbar \{\n  position: fixed !important;\n  inset-inline: 0 !important;\n  top: auto !important;\n  bottom: 0px !important;/);
  assert.ok(group.includes(":has(#TabsToolbar:hover) #PersonalToolbar"));
  assert.ok(group.includes(":has(#PersonalToolbar:hover) #TabsToolbar"));
  // As the group opens, the inner bar moves out by the outer one's growth.
  assert.ok(group.includes("#TabsToolbar {\n  position: fixed !important;\n  inset-inline: 0 !important;\n  top: auto !important;\n  bottom: calc(0px + max(var(--ahtb-open), var(--ahtb-reopen)) * (var(--ahtb-bm-height) - 0px)) !important;"));

  // Pushing the page, it makes room for the open group.
  const push = generateCss({ ...defaults(), position: "bottom", overlay: false, bookmarksPosition: "bottom", bookmarksAutoHide: true, barOrder: "toolbar,tabs,bookmarks" });
  assert.ok(push.includes("margin-bottom: calc(var(--ahtb-collapsed) + max(var(--ahtb-open), var(--ahtb-reopen)) * (calc(var(--ahtb-bm-height) + var(--ahtb-expanded)) - var(--ahtb-collapsed))) !important;"));
});

test("an auto-hiding toolbar with strips on the other edge wipes its rows", () => {
  const css = generateCss({ ...defaults(), toolbarAutoHide: true, bookmarksPosition: "bottom" });
  assert.doesNotMatch(stripComments(css), /translate:/);
  assert.ok(css.includes("#navigator-toolbox:hover:not(:has(#PersonalToolbar:hover))"));
  assert.match(css, /:root:not\(\[inFullscreen\], \[customizing\]\) #PersonalToolbar \{\n  pointer-events: auto !important;/);
  // The rows left in the toolbox are the ones that get wiped.
  assert.ok(css.includes("#navigator-toolbox > :is(#nav-bar, #toolbar-menubar)"));
});

test("bars in the toolbox follow the chosen order", () => {
  const css = generateCss({ ...defaults(), barOrder: "bookmarks,toolbar,tabs" });
  assert.match(css, /#PersonalToolbar \{\n  order: 1 !important;/);
  assert.match(css, /#toolbar-menubar,\n:root:not\(\[inFullscreen\], \[customizing\]\) #nav-bar \{\n  order: 2 !important;/);
  // Read upward at the bottom: the last in the order sits at the window's edge.
  const bottom = generateCss({ ...defaults(), toolbarPosition: "bottom", bookmarksPosition: "bottom", barOrder: "bookmarks,toolbar,tabs" });
  assert.match(bottom, /#PersonalToolbar \{\n  order: 1 !important;/);
});

test("Firefox's line between the bars and the page goes where the page reaches the window's edge", () => {
  const TOP = "#tabbrowser-tabpanels > :not(.split-view-panel) .browserContainer {\n  border-block-start: none !important;";
  const SIDE = "#tabbrowser-tabpanels > :not(.split-view-panel) .browserContainer {\n  border-inline: none !important;";
  // Every bar on the top edge hides.
  assert.ok(generateCss({ ...defaults(), toolbarAutoHide: true }).includes(TOP));
  assert.ok(generateCss({ ...defaults(), position: "left", toolbarAutoHide: true }).includes(TOP));
  // The toolbar stays shown at the top: Firefox's line under it stays.
  assert.ok(!generateCss(defaults()).includes(TOP));
  assert.ok(!generateCss({ ...REGULAR_LAYOUT }).includes(TOP));
  // Nothing on the top edge at all.
  assert.ok(generateCss({ ...defaults(), position: "bottom", toolbarPosition: "bottom", bookmarksPosition: "bottom" }).includes(TOP));
  // A bookmarks bar left alone at the top counts only while Firefox shows it.
  const bookmarksOnTop = { ...defaults(), position: "left", toolbarPosition: "bottom", bookmarksPosition: "top" };
  assert.ok(generateCss({ ...bookmarksOnTop, bookmarksVisibility: "never" }).includes(TOP));
  assert.ok(generateCss({ ...bookmarksOnTop, bookmarksVisibility: "newtab" }).includes(`:has(#PersonalToolbar[collapsed]:not([collapsed="false"])) ${TOP}`));
  // A side tab bar that hides takes its line along, unless a sidebar panel is open.
  assert.ok(generateCss({ ...defaults(), position: "left" }).includes(`#tabbrowser-tabbox:not([sidebar-panel-open], [ai-window-open]) ${SIDE}`));
  assert.ok(!generateCss({ ...defaults(), position: "left", autoHide: false }).includes(SIDE));
  assert.ok(!generateCss({ ...defaults(), position: "top" }).includes(SIDE));
});

test("a tab's [open] mark doesn't hold the toolbar open; the tab panels people use do", () => {
  const css = generateCss({ ...defaults(), position: "top", toolbarAutoHide: true });
  // Firefox's tab hover preview leaves [open] behind on a tab.
  assert.ok(css.includes('[open]:not([open="false"], #tabbrowser-tabs *))'));
  assert.ok(!css.includes('[open]:not([open="false"]))'));
  assert.ok(css.includes(":has(:is(#tab-group-editor, #tab-note-menu) panel[panelopen]) #navigator-toolbox"));
  // The tab strip's own conditions only ever looked at its toolbar buttons.
  const strip = generateCss({ ...defaults(), position: "top" });
  assert.ok(strip.includes(":has(#TabsToolbar toolbarbutton[open])"));
  assert.ok(strip.includes(":has(:is(#tab-group-editor, #tab-note-menu) panel[panelopen]) #TabsToolbar"));
});

test("an open bar's hover zone gives way, so the page right beside it can be clicked", () => {
  // The sliding toolbar clips off the part of its zone below the rows.
  const top = generateCss({ ...defaults(), position: "top", toolbarAutoHide: true });
  assert.ok(top.includes(`clip-path: inset(0 0 calc(${OPENNESS} * clamp(0px, 100% - var(--ahtb-toolbar-trigger), var(--ahtb-toolbar-trigger))) 0) !important;`));
  const bottom = generateCss({ ...defaults(), position: "left", toolbarAutoHide: true, toolbarPosition: "bottom", bookmarksPosition: "bottom" });
  assert.ok(bottom.includes(`clip-path: inset(calc(${OPENNESS} * clamp(0px, 100% - var(--ahtb-toolbar-trigger), var(--ahtb-toolbar-trigger))) 0 0 0) !important;`));
  // The side tab bar's zone shrinks by its growth.
  const side = generateCss({ ...defaults(), position: "left" });
  assert.ok(side.includes(`border-inline-end: ${zone("var(--ahtb-trigger)", SIDE_GROWTH)} solid transparent !important;`));
  // Strips: by the growth of their whole group, in the toolbox and on the other edge.
  const group = generateCss({ ...defaults(), position: "top", bookmarksAutoHide: true, barOrder: "toolbar,tabs,bookmarks" });
  assert.ok(group.includes(`border-bottom: ${zone("var(--ahtb-bm-trigger)", "calc(var(--ahtb-expanded) + var(--ahtb-bm-height)) - var(--ahtb-collapsed)")} solid transparent !important;`));
  const fixed = generateCss({ ...defaults(), position: "bottom" });
  assert.ok(fixed.includes(`border-top: ${zone("var(--ahtb-trigger)", SIDE_GROWTH)} solid transparent !important;`));
  // The wiped toolbar's strip already sits under the rows once they open.
  const wipe = generateCss({ ...defaults(), position: "bottom", toolbarAutoHide: true });
  assert.ok(!stripComments(wipe).includes("#navigator-toolbox {\n  clip-path"));
});
