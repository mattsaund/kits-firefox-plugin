// Turns settings into the userChrome stylesheet the helper installs.
//
// The mechanics generalize the original hand-written userChrome.css: a bar
// always reserves exactly --ahtb-collapsed of layout space, a transparent
// border of --ahtb-trigger reaches past its visible edge to catch the pointer,
// and a negative margin hands that border (and, in overlay mode, the extra
// size gained when opening) back to the page, so the page never reflows.
//
//   left/right tabs: Firefox's vertical tabs, #sidebar-container
//   top/bottom tabs: Firefox's horizontal tabs, #TabsToolbar
//   toolbar:         #navigator-toolbox (nav bar, bookmarks, horizontal tabs)
//
// Every declaration is !important: userChrome.css is a user sheet, and normal
// user declarations lose to Firefox's own (author-level) browser CSS.
//
// Settings go through sanitize() first, so values can be interpolated as-is.

import { BARS, barLayout, easingCss, isVertical, sanitize } from "./settings.js";

const PRODUCT_NAME = "Kits Editor for Firefox";

// Context menus that can be opened from inside a bar. Firefox drops :hover
// while one is open, so an active item in these keeps the bar expanded. The
// page's own context menu is deliberately absent: right-clicking the page
// should let the bars close.
const TAB_MENUS = ["#tabContextMenu", "#open-tab-group-context-menu", "#saved-tab-group-context-menu"];
const SIDEBAR_MENUS = [
  "#sidebar-context-menu",
  "#sidebar-bookmarks-context-menu",
  "#sidebar-history-context-menu",
  "#sidebar-opentabs-context-menu",
  "#sidebar-synced-tabs-context-menu",
];

// Horizontal and toolbar rules stand down in fullscreen (Firefox auto-hides
// the toolbox itself there) and in Customize mode (everything must stay
// editable there).
const HGUARD = ":root:not([inFullscreen], [customizing])";


// Room for the window controls when the top tab strip slides over the nav
// bar: the macOS traffic lights at the start, Windows' minimize, maximize and
// close (three 46px caption buttons) at the end.
const MAC_WINDOW_CONTROLS = "76px";
const WINDOWS_WINDOW_CONTROLS = "138px";


// The theme's toolbox color can be translucent (it is on macOS), which would
// let the page show through anything overlaid on it. Layer it over an opaque
// base, the same way Firefox's own expand-on-hover sidebar does.
const OPAQUE_THEME_BACKGROUND = [
  "background-color: light-dark(#e8e8e8, #202020)",
  "background-image: image(var(--toolbox-background-color))",
];

// How open each element that hides is, from 0 to 1. Two registered
// properties carry it, and the element's sizes, offsets and shadow are written
// in terms of OPENNESS, with no transitions of their own, so they follow it
// every frame. Normally both properties move together: to 1 after the open
// delay, to 0 after the close delay. Only the hold rules point them different
// ways (see holdRule). Not inherited, so animating a bar doesn't restyle every
// tab inside it.
const OPEN_STATE = ["--ahtb-open", "--ahtb-reopen"]
  .map((name) => `@property ${name} {\n  syntax: "<number>";\n  inherits: false;\n  initial-value: 0;\n}`)
  .join("\n\n");
const OPENNESS = "max(var(--ahtb-open), var(--ahtb-reopen))";

/**
 * A hover zone's depth: `size` while the bar is closed, giving up whatever
 * part of it the bar covers as it opens by `growth`. Open, the bar takes the
 * pointer only on itself, so the page right beside it can be clicked; a zone
 * deeper than the bar grows keeps the rest.
 */
function zoneDepth(size, growth) {
  return `calc(${size} - ${OPENNESS} * clamp(0px, ${growth}, ${size}))`;
}

// Firefox panels anchored to a tab (its hover preview, tab notes) mark the tab
// [open]. The hover preview moves from tab to tab while open, and on closing
// Firefox clears the mark from the last tab only, so the first keeps it for
// good. A tab's [open] therefore says nothing; the panels people use count
// while they show.
const TAB_PANELS_OPEN = ":has(:is(#tab-group-editor, #tab-note-menu) panel[panelopen])";

// The shadow of an open bar, fading in as it opens.
const SHADOW = `filter: drop-shadow(0 0 calc(12px * ${OPENNESS}) rgba(0, 0, 0, calc(0.45 * ${OPENNESS})))`;

// "Let clicks through to the page": while the pointer is on something
// clickable near an edge, the extension's page script has the background
// script show this address bar icon on that tab (content/click-through.js). A
// page action is the one piece of per-tab state an extension can set that
// appears in Firefox's own markup, so it serves as the signal; the icon itself
// is never displayed. While it exists, the hover zones let the pointer through.
const PAGE_ACTION = "#pageAction-urlbar-autohide-tab-bar_kits";
const PAGE_WANTS_POINTER = `:has(${PAGE_ACTION})`;

// Firefox sets this pref when the add-on first stores something and clears it
// when the add-on is removed. Prefs load before the first window, so rules
// guarded by it are in place from the first paint, and removing the add-on
// switches them off at once, without a restart.
// The bookmarks bar while Firefox hides it ("Only on new tab", "Never"). Older
// versions mark it [collapsed="true"], and [collapsed="false"] when shown.
const BOOKMARKS_COLLAPSED = '#PersonalToolbar[collapsed]:not([collapsed="false"])';

const INSTALLED_PREF = "extensions.webextensions.ExtensionStorageIDB.migrated.autohide-tab-bar@kits";

/** The full stylesheet for a settings object. */
export function generateCss(input) {
  const s = sanitize(input);
  return `${header(s)}

/* How open each hiding bar is (see OPEN_STATE). Registering it styles nothing. */
${OPEN_STATE}

/* Everything below applies only while ${PRODUCT_NAME} is installed (see INSTALLED_PREF). */
@media (-moz-pref("${INSTALLED_PREF}")) {

${rules(s)}
}
`;
}

/** Every rule of the stylesheet. */
function rules(s) {
  const blocks = [variables(s)];
  if (isVertical(s.position)) blocks.push(...verticalRules(s));
  blocks.push(...barRules(s));
  blocks.push(...appearanceRules(s));
  blocks.push(...toolbarRules(s));
  blocks.push(...urlbarRules(s));
  blocks.push(...bookmarksRules(s));
  blocks.push(...pageEdgeRules(s));
  if (s.reducedMotion && (s.autoHide || s.toolbarAutoHide || s.bookmarksAutoHide)) blocks.push(reducedMotionRule(s));
  blocks.push(`/* The signal from "Let clicks through to the page" (see PAGE_ACTION); never shown. */
${rule(PAGE_ACTION, ["display: none"])}`);
  return blocks.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

/** A comment saying what this file is and where to change it. */
function header(s) {
  const mode = !s.autoHide ? "always open" : s.overlay ? "auto-hide, overlay" : "auto-hide, push";
  const toolbar = `toolbar on the ${s.toolbarPosition}${s.toolbarAutoHide ? ", auto-hide" : ""}`;
  return `/* ${PRODUCT_NAME}: tab bar on the ${s.position} (${mode}); ${toolbar}.
   Written by the ${PRODUCT_NAME} extension. Change settings there rather
   than editing this file; it is replaced every time you apply. */`;
}

/** The numbers every other rule refers to, as custom properties on :root. */
function variables(s) {
  const expanded = isVertical(s.position)
    ? `${s.expandedWidth}px`
    : s.expandedHeightAuto
      ? "var(--tabstrip-min-height)"
      : `${s.expandedHeight}px`;
  return `:root {
  --ahtb-collapsed: ${s.collapsedSize}px;
  --ahtb-expanded: ${expanded};
  --ahtb-trigger: ${s.triggerSize}px;
  --ahtb-duration: ${s.duration}ms;
  --ahtb-easing: ${easingCss(s.easing)};
  --ahtb-open-delay: ${s.openDelay}ms;
  --ahtb-close-delay: ${s.closeDelay}ms;
  --ahtb-toolbar-trigger: ${s.toolbarTriggerSize}px;
  --ahtb-bm-height: ${bookmarksBarHeight(s)}px;
  --ahtb-bm-trigger: ${s.bookmarksTriggerSize}px;
}

/* While Firefox hides the bookmarks bar ("Only on new tab", "Never") it takes
   no room and has no hover zone. Firefox marks it [collapsed] (older versions
   with "true", and "false" when shown). */
${rule(`:root:has(${BOOKMARKS_COLLAPSED})`, ["--ahtb-bm-height: 0px", "--ahtb-bm-trigger: 0px"])}`;
}

/** The bookmarks bar's height: its bookmarks plus Firefox's 2px margin around them. */
function bookmarksBarHeight(s) {
  return (s.bookmarksHeightCustom ? s.bookmarksHeight : 24) + 4;
}

/** One CSS rule; every declaration gets !important (see the file comment). */
function rule(selectors, declarations) {
  const sel = Array.isArray(selectors) ? selectors.join(",\n") : selectors;
  const body = declarations.map((d) => `  ${d} !important;`).join("\n");
  return `${sel} {\n${body}\n}`;
}

/**
 * The closed state of an element that hides, and the transitions that carry
 * its openness: after the close delay; the open rule swaps in the open delay.
 */
function stateTransition() {
  return [
    "--ahtb-open: 0",
    "--ahtb-reopen: 0",
    "transition-property: --ahtb-open, --ahtb-reopen",
    "transition-duration: var(--ahtb-duration)",
    "transition-timing-function: var(--ahtb-easing)",
    "transition-delay: var(--ahtb-close-delay)",
  ];
}

/** The open state of an element that hides, reached after the open delay. */
function openState() {
  return ["--ahtb-open: 1", "--ahtb-reopen: 1", "transition-delay: var(--ahtb-open-delay)"];
}

/** Fixes a horizontal tab strip at the given height. */
function fixedHeight(selector, height) {
  return rule(selector, [`min-height: ${height}`, `max-height: ${height}`]);
}

/**
 * "Hold" rules: while the pointer is somewhere Firefox can't see it, the bars
 * keep whatever state they are in instead of closing.
 *
 *   - Outside the window. On macOS the outermost pixels of a window (and the
 *     menu bar above a maximized one) belong to the system, so pushing the
 *     pointer against the screen edge counts as leaving the window. So does
 *     hovering the window buttons, and a native right-click menu.
 *   - Over a menu or panel: a right-click menu on a tab or the toolbar, the
 *     tab group editor, a bookmark folder.
 *   - While a Firefox dialog is open, such as Edit Bookmark.
 *
 * CSS can't remember state, so transitions do. While the pointer is out of
 * sight, --ahtb-open is pointed at 1 and --ahtb-reopen at 0.5, both a day
 * away. A transition already heading for the same end carries on, so an open
 * bar stays open and one that has started opening finishes; anything else
 * waits out the day, so a closed bar stays closed and --ahtb-reopen stays as
 * it is. Back over the page, both head for 0 again. Back on the bar, both head
 * for 1, and --ahtb-reopen opens it even if --ahtb-open is still waiting out
 * its day. (A bar caught closing stops where it is until the pointer is back.)
 *
 * The sizes follow the openness rather than transitioning themselves: a
 * transition aims at the new target at once, which would close the bar the
 * moment the pointer reached the window buttons, and skip the close delay.
 *
 * The selectors are less specific than the bar's own non-hover open
 * conditions (dragging a tab, an active menu item, typing in the address
 * bar), so those still win.
 */
function holdRule(root, targets) {
  return rule(holdSelectors(root, targets), ["--ahtb-open: 1", "--ahtb-reopen: 0.5", "transition-delay: 86400s"]);
}

function holdSelectors(root, targets) {
  const conditions = [":not(:hover)", ":has(:is(menupopup, panel):hover)", ":has(#window-modal-dialog[open])"];
  return [targets].flat().flatMap((target) => conditions.map((c) => `${root}${c} ${target}`));
}

/**
 * Selectors under which a tab bar should be open. `root` prefixes the
 * conditions that live outside the bar (open panels and menus).
 */
function expandedSelectors({ root = ":root", target, menus, extraSelf = [] }) {
  const self = [
    // The pointer is over the bar or its hover strip.
    ":hover",
    // Firefox suppresses :hover during a drag; these attributes last from
    // dragstart to drop, so a tab being reordered doesn't lose its strip.
    ":has(#tabbrowser-tabs[movingtab])",
    ":has(tab-group[movingtabgroup])",
    ...extraSelf,
  ];
  const menuList = menus.join(", ");
  const outside = [
    // The tab group and tab note editors, while shown (see TAB_PANELS_OPEN).
    TAB_PANELS_OPEN,
    // <menupopup> exposes no open state, but Gecko puts [_moz-menuactive] on
    // the highlighted item of an open menu; submenus are nested in the DOM so
    // they are covered too. The hold rules cover the moments in between.
    `:has(:is(${menuList}) :is(menu, menuitem)[_moz-menuactive])`,
    `:has(:is(${menuList}):hover)`,
  ];
  const lead = root === ":root" ? "" : `${root} `;
  return [...self.map((c) => `${lead}${target}${c}`), ...outside.map((c) => `${root}${c} ${target}`)];
}

/** An edge line drawn inside a bar, on the side facing the page. */
function edgeShadow(side, s) {
  const w = `${s.edgeWidth}px`;
  const offsets = {
    left: `calc(-1 * ${w}) 0`,
    right: `${w} 0`,
    top: `0 calc(-1 * ${w})`,
    bottom: `0 ${w}`,
  };
  return `box-shadow: inset ${offsets[side]} 0 0 ${s.edgeColor}`;
}

/** Indents a block of CSS, for rules inside an @media block. */
function indent(text) {
  return text
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}

/**
 * Where things sit (see barLayout in settings.js), plus what the rules here
 * need to know about it.
 */
function layout(s) {
  const L = barLayout(s);
  const vertical = isVertical(s.position);
  const fixedSels = L.fixed.map((bar) => STRIPS[bar].sel);
  return {
    ...L,
    vertical,
    tabsInToolbox: !vertical && L.inToolbox("tabs"),
    bookmarksInToolbox: L.inToolbox("bookmarks"),
    fixedSels,
    // The toolbar's rows: the nav bar and menu bar, plus whatever shares its edge.
    rows: [
      "#nav-bar",
      ...(L.inToolbox("bookmarks") ? ["#PersonalToolbar"] : []),
      "#toolbar-menubar",
      ...(!vertical && L.inToolbox("tabs") ? ["#TabsToolbar"] : []),
    ],
    // A transformed toolbox would capture the fixed strips inside it (dragging
    // them along, and Firefox stops painting them), so with any fixed strip an
    // auto-hiding toolbar's rows are wiped with clip-path instead.
    toolbarWipe: s.toolbarAutoHide && fixedSels.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Left / right: vertical tabs in #sidebar-container
// ---------------------------------------------------------------------------

/** The sidebar tab bar: fixed width, or collapsing with a hover strip. */
function verticalRules(s) {
  const T = "#sidebar-container";
  // Firefox puts [sidebar-positionend] on the container when the sidebar is on
  // the right. Both sides are emitted so the bar still works if the side is
  // flipped from Firefox's own menu before the next restart.
  const sides = [
    { sel: `${T}:not([sidebar-positionend])`, inner: "end" },
    { sel: `${T}[sidebar-positionend]`, inner: "start" },
  ];
  const menus = [...TAB_MENUS, ...SIDEBAR_MENUS];
  const blocks = [];

  blocks.push(`/* The launcher splitter would let the bar be dragged to a width that
   fights the fixed sizes below. */
${rule("#sidebar-launcher-splitter", ["display: none"])}`);

  if (!s.autoHide) {
    blocks.push(rule(T, ["min-width: var(--ahtb-expanded)", "max-width: var(--ahtb-expanded)"]));
    return blocks;
  }

  const props = ["min-width", "max-width", "margin-inline-start", "margin-inline-end", ...(s.shadow ? ["filter"] : [])];
  // Open, the bar grows by this much; sliding over the page, its margin hands
  // the growth back so the page stays put.
  const growth = `${OPENNESS} * (var(--ahtb-expanded) - var(--ahtb-collapsed))`;
  const zone = zoneDepth("var(--ahtb-trigger)", "var(--ahtb-expanded) - var(--ahtb-collapsed)");
  const width = `calc(var(--ahtb-collapsed) + ${zone} + ${growth})`;

  blocks.push(`/* Border box = collapsed + trigger, plus the growth while open; the trigger
   is a transparent border (still a hit target) and overflow clips to the
   padding box, so only the collapsed part shows when closed. The negative
   margin returns the trigger's space to the page. */
${rule(T, [
  "box-sizing: border-box",
  `min-width: ${width}`,
  `max-width: ${width}`,
  "overflow: hidden",
  "position: relative",
  "z-index: 100",
  "background-clip: padding-box",
  ...(s.shadow ? [SHADOW] : []),
  ...stateTransition(),
])}`);

  for (const { sel, inner } of sides) {
    blocks.push(
      rule(sel, [
        `border-inline-${inner}: ${zone} solid transparent`,
        `margin-inline-${inner}: ${s.overlay ? `calc(-1 * ${zone} - ${growth})` : `calc(-1 * ${zone})`}`,
      ]),
    );
  }

  // The signal only exists while the pointer is on the page, so the bar is
  // closed or closing and nothing of it is in use.
  blocks.push(`/* Pointing at something clickable near the edge: the hover zone lets the
   pointer through to the page (see PAGE_ACTION). */
${rule(`:root${PAGE_WANTS_POINTER} ${T}`, ["pointer-events: none"])}`);

  blocks.push(`/* Hold the open state while the pointer is out of Firefox's sight (see holdRule). */
${holdRule(
  ":root",
  sides.map(({ sel }) => sel),
)}`);

  const open = sides.map(({ sel }) => expandedSelectors({ target: sel, menus }));
  blocks.push(`/* Open. */
${rule(open.flat(), openState())}`);

  return blocks;
}

// ---------------------------------------------------------------------------
// Top / bottom: the tab strip and the bookmarks bar
// ---------------------------------------------------------------------------

// The horizontal bars that can hide on their own (the toolbar hides as the
// whole toolbox, see toolbarRules): their sizes, and what keeps each open.
// The conditions are written from the root, as :has() can't nest.
const STRIPS = {
  tabs: {
    name: "Tab strip",
    sel: "#TabsToolbar",
    collapsed: "var(--ahtb-collapsed)",
    expanded: "var(--ahtb-expanded)",
    trigger: "var(--ahtb-trigger)",
    shadow: true,
    open: [
      ":has(#TabsToolbar:hover)",
      // Firefox suppresses :hover during a drag; these last from dragstart to
      // drop, so a tab being reordered doesn't lose its strip.
      ":has(#tabbrowser-tabs[movingtab])",
      ":has(tab-group[movingtabgroup])",
      // Toolbar buttons in the strip (e.g. "List all tabs") while their panel shows.
      ":has(#TabsToolbar toolbarbutton[open])",
      TAB_PANELS_OPEN,
      `:has(:is(${TAB_MENUS.join(", ")}) :is(menu, menuitem)[_moz-menuactive])`,
      `:has(:is(${TAB_MENUS.join(", ")}):hover)`,
    ],
  },
  bookmarks: {
    name: "Bookmarks bar",
    sel: "#PersonalToolbar",
    collapsed: "0px",
    expanded: "var(--ahtb-bm-height)",
    trigger: "var(--ahtb-bm-trigger)",
    shadow: false,
    open: [
      ":has(#PersonalToolbar:hover)",
      // A bookmarks folder's menu marks its button [open].
      ':has(#PersonalToolbar [open]:not([open="false"]))',
      ":has(#placesContext :is(menu, menuitem)[_moz-menuactive])",
      ":has(#placesContext:hover)",
    ],
  },
};

/** The side of a bar on this edge that faces the page. */
function pageSide(edge) {
  return edge === "top" ? "bottom" : "top";
}

/** A selector list as one selector: itself if there's one, else :is(). */
function oneOrIs(selectors) {
  return selectors.length === 1 ? selectors[0] : `:is(${selectors.join(", ")})`;
}

/** Adds CSS lengths. */
function sum(lengths) {
  const parts = lengths.filter((length) => length !== "0px");
  if (!parts.length) return "0px";
  return parts.length === 1 ? parts[0] : `calc(${parts.join(" + ")})`;
}

/** How much a group of bars grows by, opening. */
function groupSpan(group) {
  return `${sum(group.map((bar) => STRIPS[bar].expanded))} - ${sum(group.map((bar) => STRIPS[bar].collapsed))}`;
}

/** What opens a group of bars: whatever opens any one of them. */
function groupOpen(group) {
  return [...new Set(group.flatMap((bar) => STRIPS[bar].open))];
}

/** The horizontal bars: order in the toolbox, hiding, and strips on the other edge. */
function barRules(s) {
  const L = layout(s);
  const blocks = [];

  if (s.tabHeightCustom && !L.vertical) {
    // Firefox derives the strip's height (--tabstrip-min-height, which "Match
    // Firefox's tab height" follows) from this on :root.
    blocks.push(`/* Tab thickness. */
${rule(":root", [`--tab-min-height: ${s.tabHeight}px`])}`);
  }
  blocks.push(...toolboxOrder(L));
  if (controlsLeaveTabStrip(L)) blocks.push(windowControlsToNavBar());
  const toolboxHides = ["tabs", "bookmarks"].some((bar) => L.inToolbox(bar) && L.hiding[bar] === "own");
  if (L.fixed.length || toolboxHides) {
    // The toolbox is its own stacking context below the page (z-index 0 vs 2),
    // which would trap the strips, and the hover zones they reach over the
    // page with, underneath the content they are meant to cover. Firefox also
    // clips the toolbox, which would cut off a strip in it that reaches out.
    blocks.push(rule(`${HGUARD} #navigator-toolbox`, ["z-index: 3", ...(toolboxHides ? ["overflow: visible"] : [])]));
  }
  // A tab strip in the toolbox that doesn't hide on its own keeps a custom height.
  if (L.tabsInToolbox && L.hiding.tabs !== "own" && !s.expandedHeightAuto) {
    blocks.push(fixedHeight(`${HGUARD} #TabsToolbar`, "var(--ahtb-expanded)"));
  }

  for (const bar of ["tabs", "bookmarks"]) {
    if (L.edgeOf[bar] && L.inToolbox(bar) && L.hiding[bar] === "own") blocks.push(...toolboxStrip(s, L, bar));
  }
  if (L.fixed.length) blocks.push(...fixedStrips(s, L));

  for (const bar of ["tabs", "bookmarks"]) {
    if (L.hiding[bar] !== "own") continue;
    const { sel, name } = STRIPS[bar];
    // A strip's contents stay pinned to its outer edge, so they slide into
    // view rather than being uncovered in place. (Firefox already aligns the
    // tabs to the bottom, which is right for the top edge.)
    if (bar === "tabs" && L.edgeOf.tabs === "bottom") {
      blocks.push(rule(`${HGUARD} #TabsToolbar > .toolbar-items`, ["align-items: flex-start"]));
    }
    if (bar === "bookmarks") {
      blocks.push(rule(`${HGUARD} #PersonalToolbar`, [`align-items: ${L.edgeOf.bookmarks === "top" ? "flex-end" : "flex-start"}`]));
    }
    blocks.push(`/* ${name}: pointing at something clickable near the edge lets the pointer
   through its hover zone to the page (see PAGE_ACTION). */
${rule(`${HGUARD}${PAGE_WANTS_POINTER} ${sel}`, ["pointer-events: none"])}`);
  }
  // Out of the toolbox, or sliding over the page, the bookmarks bar needs a
  // background of its own: Firefox's is translucent over the toolbox.
  if (L.hiding.bookmarks === "own" || L.fixed.includes("bookmarks")) {
    blocks.push(rule(`${HGUARD} #PersonalToolbar`, OPAQUE_THEME_BACKGROUND));
  }

  const tabsSlideOverControls =
    L.tabsInToolbox && L.toolbarEdge === "top" && L.hiding.tabs === "own" && s.overlay && L.stacks.top[0] === "tabs";
  if (tabsSlideOverControls) {
    blocks.push(`/* Sliding over the nav bar: clear the window controls. */
@media (-moz-platform: macos) {
${indent(rule(`${HGUARD}[customtitlebar] #TabsToolbar`, [`padding-inline-start: ${MAC_WINDOW_CONTROLS}`]))}
}

@media (-moz-platform: windows) {
${indent(rule(`${HGUARD}[customtitlebar] #TabsToolbar`, [`padding-inline-end: ${WINDOWS_WINDOW_CONTROLS}`]))}
}`);
  }
  return blocks;
}

/** The bars' order inside the toolbox, when it isn't Firefox's own. */
function toolboxOrder(L) {
  const outward = L.stacks[L.toolbarEdge];
  const topDown = L.toolbarEdge === "top" ? outward : [...outward].reverse();
  // BARS lists them in Firefox's own order.
  if (topDown.join() === BARS.filter((bar) => topDown.includes(bar)).join()) return [];
  const rows = { tabs: ["#TabsToolbar"], toolbar: ["#toolbar-menubar", "#nav-bar"], bookmarks: ["#PersonalToolbar"] };
  const orders = topDown.map((bar, i) => rule(rows[bar].map((sel) => `${HGUARD} ${sel}`), [`order: ${i + 1}`]));
  return [`/* The bars on the ${L.toolbarEdge}, top to bottom: ${topDown.join(", ")}. Firefox's
   notification bars stay last. */
${[...orders, rule(`${HGUARD} #notifications-toolbar`, [`order: ${topDown.length + 1}`])].join("\n\n")}`];
}

/**
 * With horizontal tabs the window controls (and the window drag area) live in
 * the tab strip. When the strip hides on its own, leaves the top, or isn't the
 * top row, they move to the nav bar, where Firefox puts them for vertical
 * tabs. A strip hiding along with the toolbar takes them with it. (A bottom
 * toolbar uses Firefox's own title bar instead; see firefoxPrefs.)
 */
function controlsLeaveTabStrip(L) {
  if (L.toolbarEdge !== "top" || L.vertical) return false;
  if (!L.tabsInToolbox || L.hiding.tabs === "own") return true;
  return L.hiding.tabs === null && L.stacks.top[0] !== "tabs";
}

/**
 * A bar inside the toolbox that hides on its own: the side tab bar's
 * arithmetic along the vertical axis. Its closed box is the visible part plus
 * a transparent border, the hover zone, on the page side; a negative margin
 * hands the zone back so nothing moves. Neighbours that also hide open
 * together, and only the innermost carries the zone (see barLayout).
 */
function toolboxStrip(s, L, bar) {
  const m = STRIPS[bar];
  const group = L.groups[bar];
  const innermost = group.at(-1) === bar;
  const side = pageSide(L.toolbarEdge);
  const shadow = s.shadow && m.shadow;
  const zone = zoneDepth(m.trigger, groupSpan(group));
  const height = `calc(${m.collapsed}${innermost ? ` + ${zone}` : ""} + ${OPENNESS} * (${m.expanded} - ${m.collapsed}))`;
  // Sliding over the page, the innermost bar's margin cancels the whole
  // group's growth, so the page beyond stays where it was.
  const groupGrowth = `${OPENNESS} * (${groupSpan(group)})`;
  const margin = s.overlay ? `calc(-1 * ${zone} - ${groupGrowth})` : `calc(-1 * ${zone})`;
  const props = ["min-height", "max-height", ...(innermost ? [`margin-${side}`] : []), ...(shadow ? ["filter"] : [])];

  return [
    `/* ${m.name}, in the toolbox: closed it keeps its visible part and, on the page
   side, a transparent border as the hover zone. It grows toward the page,
   over the bars and the page beyond it. */
${rule(`${HGUARD} ${m.sel}`, [
  "box-sizing: border-box",
  `min-height: ${height}`,
  `max-height: ${height}`,
  ...(innermost ? [`border-${side}: ${zone} solid transparent`, "background-clip: padding-box", `margin-${side}: ${margin}`] : []),
  "overflow: hidden",
  "position: relative",
  "z-index: 10",
  ...(shadow ? [SHADOW] : []),
  ...stateTransition(),
])}`,
    `/* Hold the open state while the pointer is out of Firefox's sight (see holdRule). */
${holdRule(HGUARD, m.sel)}`,
    `/* Open. */
${rule(
  groupOpen(group).map((c) => `${HGUARD}${c} ${m.sel}`),
  openState(),
)}`,
  ];
}

/**
 * The bars on the other edge from the toolbar: fixed strips stacked from the
 * window's edge inward, with the page kept clear of them. A strip that hides
 * keeps its visible part and a hover zone; bars that open over others
 * (sliding) cover them, and bars that push move the ones inside them along.
 */
function fixedStrips(s, L) {
  const edge = L.otherEdge;
  const side = pageSide(edge);
  const bars = L.fixed;
  // Two bars at most, so at most one group of hiding ones.
  const group = bars.filter((bar) => L.hiding[bar] === "own");
  const open = groupOpen(group).map((c) => `${HGUARD}${c}`);
  const restSize = (bar) => (group.includes(bar) ? STRIPS[bar].collapsed : STRIPS[bar].expanded);
  const openSize = (bar) => (group.includes(bar) ? STRIPS[bar].expanded : restSize(bar));
  const offset = (i, opened) => sum(bars.slice(0, i).map(opened ? openSize : restSize));
  /** A length that goes from `closed` to `opened` with the open state. */
  const follow = (closed, opened) => (closed === opened ? closed : `calc(${closed} + ${OPENNESS} * (${opened} - ${closed}))`);
  const blocks = [];

  bars.forEach((bar, i) => {
    const m = STRIPS[bar];
    const hides = group.includes(bar);
    const innermost = hides && group.at(-1) === bar;
    const shadow = hides && s.shadow && m.shadow;
    // Sliding open, only the group's own bars move; pushing, everything inside it does.
    const closedOffset = offset(i, false);
    const openOffset = hides || !s.overlay ? offset(i, true) : closedOffset;
    const moves = group.length > 0 && openOffset !== closedOffset;
    const zone = zoneDepth(m.trigger, groupSpan(group));
    const trigger = innermost ? ` + ${zone}` : "";
    const height = hides ? `calc(${m.collapsed}${trigger} + ${OPENNESS} * (${m.expanded} - ${m.collapsed}))` : m.expanded;
    const props = [...(hides ? ["min-height", "max-height"] : []), ...(moves ? [edge] : []), ...(shadow ? ["filter"] : [])];

    blocks.push(`/* ${m.name}: a fixed strip on the ${edge} edge${i ? `, inside the ${STRIPS[bars[i - 1]].name.toLowerCase()}` : ""}. */
${rule(`${HGUARD} ${m.sel}`, [
  "position: fixed",
  "inset-inline: 0",
  `${side}: auto`,
  `${edge}: ${follow(closedOffset, openOffset)}`,
  "margin: 0",
  "box-sizing: border-box",
  `min-height: ${height}`,
  `max-height: ${height}`,
  // Hiding bars cover the ones they open over.
  `z-index: ${hides ? 12 : 10}`,
  ...(innermost ? [`border-${side}: ${zone} solid transparent`, "background-clip: padding-box"] : []),
  ...(hides ? ["overflow: hidden"] : []),
  ...(shadow ? [SHADOW] : []),
  ...(props.length ? stateTransition() : []),
])}`);

    if (!props.length) return;
    blocks.push(holdRule(HGUARD, m.sel));
    blocks.push(
      rule(
        open.map((c) => `${c} ${m.sel}`),
        openState(),
      ),
    );
  });

  // The page keeps clear of the strips' closed sizes, or, pushing, their open ones.
  const pageMargin = `margin-${edge}`;
  const closedTotal = sum(bars.map(restSize));
  const pushes = !s.overlay && group.length > 0;
  blocks.push(`/* The page makes room for the strips. */
${rule(`${HGUARD} #browser`, [
  `${pageMargin}: ${pushes ? follow(closedTotal, sum(bars.map(openSize))) : closedTotal}`,
  ...(pushes ? stateTransition() : []),
])}`);
  if (pushes) {
    blocks.push(holdRule(HGUARD, "#browser"));
    blocks.push(
      rule(
        open.map((c) => `${c} #browser`),
        openState(),
      ),
    );
  }
  return blocks;
}

function windowControlsToNavBar() {
  return `/* Window controls and dragging move to the nav bar, as with vertical tabs. */
${rule(`${HGUARD}[customtitlebar] #nav-bar > .titlebar-buttonbox-container`, ["display: flex"])}

${rule(`${HGUARD} #TabsToolbar > :is(.titlebar-buttonbox-container, .titlebar-spacer)`, ["display: none"])}

${rule(`${HGUARD}[customtitlebar] #nav-bar`, ["-moz-window-dragging: drag"])}`;
}

// ---------------------------------------------------------------------------
// Tab bar colors, edge line, corner radius
// ---------------------------------------------------------------------------

/** "#rrggbb" at an opacity percentage; the hex itself when fully opaque. */
export function hexToRgba(hex, opacityPercent) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return opacityPercent >= 100 ? hex : `rgba(${r}, ${g}, ${b}, ${opacityPercent / 100})`;
}

/** The tab bar's colors and shape. Theme choices emit nothing. */
function appearanceRules(s) {
  const vertical = isVertical(s.position);
  const target = vertical ? "#sidebar-container" : "#TabsToolbar";
  const decls = [];
  const blocks = [];

  if (s.backgroundCustom) {
    decls.push(`background-color: ${hexToRgba(s.backgroundColor, s.backgroundOpacity)}`, "background-image: none");
  } else if (s.autoHide && s.overlay) {
    decls.push(...OPAQUE_THEME_BACKGROUND);
  }
  if (s.textCustom) {
    decls.push(
      `color: ${s.textColor}`,
      `--tab-text-color: ${s.textColor}`,
      `--tab-text-color-hover: ${s.textColor}`,
      `--toolbarbutton-icon-fill: ${s.textColor}`,
    );
  }
  if (s.selectedCustom) decls.push(`--tab-background-color-selected: ${s.selectedColor}`);
  if (s.selectedTextCustom) decls.push(`--tab-text-color-selected: ${s.selectedTextColor}`);
  if (s.hoverCustom) decls.push(`--tab-background-color-hover: ${s.hoverColor}`);
  if (s.radiusCustom) decls.push(`--tab-border-radius: ${s.radius}px`);

  if (decls.length) blocks.push(rule(target, decls));

  if (vertical && (s.backgroundCustom || (s.autoHide && s.overlay))) {
    // The container paints the background; a second layer on the launcher
    // inside it would double up any transparency.
    blocks.push(rule("#sidebar-container > sidebar-main", ["background: transparent"]));
  }

  if (s.edgeWidth > 0) {
    if (vertical) {
      blocks.push(
        rule("#sidebar-container:not([sidebar-positionend])", [edgeShadow("left", s)]),
        rule("#sidebar-container[sidebar-positionend]", [edgeShadow("right", s)]),
      );
    } else {
      blocks.push(rule(target, [edgeShadow(s.position, s)]));
    }
  }
  return blocks;
}

/** No animation for anything that slides, when the system asks for less motion. */
function reducedMotionRule(s) {
  const L = layout(s);
  const targets = [];
  if (L.vertical && s.autoHide) targets.push("#sidebar-container");
  for (const bar of ["tabs", "bookmarks"]) {
    if (L.hiding[bar] === "own" || L.fixed.includes(bar)) targets.push(`${HGUARD} ${STRIPS[bar].sel}`);
  }
  if (L.fixed.length && !s.overlay) targets.push(`${HGUARD} #browser`);
  if (s.toolbarAutoHide) {
    targets.push(L.toolbarWipe ? `${HGUARD} #navigator-toolbox > :is(${L.rows.join(", ")})` : `${HGUARD} #navigator-toolbox`);
  }
  return `@media (prefers-reduced-motion: reduce) {
${indent(rule(targets, ["transition-duration: 0s"]))}
}`;
}

// ---------------------------------------------------------------------------
// Toolbar: its edge, and auto-hide (nav bar, bookmarks, tabs on the same edge)
// ---------------------------------------------------------------------------

/** The toolbar's edge, and its auto-hide when switched on. */
function toolbarRules(s) {
  const L = layout(s);
  const bottom = L.toolbarEdge === "bottom";
  const TB = `${HGUARD} #navigator-toolbox`;
  const blocks = [];

  if (bottom) {
    blocks.push(`/* Toolbar at the bottom: the toolbox follows the page in the window's column. */
${rule(TB, ["order: 1"])}`);
    blocks.push(upwardUrlbarView());
  }

  if (!s.toolbarAutoHide) return blocks;

  const trigger = "var(--ahtb-toolbar-trigger)";
  const rows = `:is(${L.rows.join(", ")})`;
  const menuList = [
    ...(L.tabsInToolbox ? TAB_MENUS : []),
    ...(L.bookmarksInToolbox ? ["#placesContext"] : []),
    "#toolbar-context-menu",
  ].join(", ");

  const self = [
    // Strips on the other edge are still descendants of the toolbox, so
    // hovering them must not count as hovering the toolbar.
    L.fixedSels.length ? `:hover:not(:has(${oneOrIs(L.fixedSels)}:hover))` : ":hover",
    // Typing in the address bar, or keyboard focus anywhere in the toolbar.
    `:has(${rows}:focus-within)`,
    // Address bar results, toolbar button panels and menus mark themselves
    // [open]; a tab's mark is unreliable (see TAB_PANELS_OPEN).
    `:has(${rows} [open]:not([open="false"], #tabbrowser-tabs *))`,
    // Windows and Linux: the menu bar Alt brings up (an auto-hiding one drops [inactive]).
    ':has(#toolbar-menubar[autohide="true"]:not([inactive]))',
    ...(L.tabsInToolbox ? [":has(#tabbrowser-tabs[movingtab])", ":has(tab-group[movingtabgroup])"] : []),
  ];
  const outside = [
    ...(L.tabsInToolbox ? [TAB_PANELS_OPEN] : []),
    `:has(:is(${menuList}) :is(menu, menuitem)[_moz-menuactive])`,
    `:has(:is(${menuList}):hover)`,
  ];
  const open = [...self.map((c) => `${TB}${c}`), ...outside.map((c) => `${HGUARD}${c} #navigator-toolbox`)];

  const background = s.toolbarBgCustom
    ? [`background-color: ${s.toolbarBgColor}`, "background-image: none"]
    : OPAQUE_THEME_BACKGROUND;
  const atEdge = bottom ? "inset: auto 0 0 0" : "inset: 0 0 auto 0";

  if (L.toolbarWipe) {
    const ROWS = `#navigator-toolbox > ${rows}`;
    // The tab strip in a wiped toolbox keeps its own background.
    const PAINTED = `#navigator-toolbox > :is(${L.rows.filter((row) => row !== "#TabsToolbar").join(", ")})`;
    // The rows open and close themselves, on the toolbox's conditions.
    const cut = `calc((1 - ${OPENNESS}) * 100%)`;
    const clip = bottom ? `inset(${cut} 0 0 0)` : `inset(0 0 ${cut} 0)`;
    blocks.push(`/* Toolbar auto-hide, with strips on the other edge. The toolbox floats over
   the page, transparent to the pointer; an invisible strip along the window
   edge catches the pointer and the rows are revealed with clip-path. */
${rule(TB, ["position: absolute", atEdge, "z-index: 200", "pointer-events: none"])}

${rule(
  L.fixedSels.map((sel) => `${HGUARD} ${sel}`),
  ["pointer-events: auto"],
)}

${rule(`${TB}::before`, [
  'content: ""',
  "position: absolute",
  atEdge,
  `height: ${trigger}`,
  "z-index: 1",
  "pointer-events: auto",
])}

${rule(`${HGUARD} ${PAINTED}`, background)}

${rule(`${HGUARD} ${ROWS}`, [`clip-path: ${clip}`, "pointer-events: none", ...stateTransition()])}

${holdRule(HGUARD, ROWS)}

${rule(holdSelectors(HGUARD, ROWS), ["pointer-events: auto"])}

${rule(
  open.map((sel) => `${sel} > ${rows}`),
  [...openState(), "pointer-events: auto"],
)}

${rule(
  open.map((sel) => `${sel}::before`),
  // Clipped parts of a row don't take the pointer, so the strip stays live
  // underneath until the rows have been revealed over it.
  ["z-index: -1"],
)}

/* Pointing at something clickable near the edge: the strip lets the pointer
   through to the page (see PAGE_ACTION). */
${rule(`${HGUARD}${PAGE_WANTS_POINTER} #navigator-toolbox::before`, ["pointer-events: none"])}`);
    return blocks;
  }

  // Closed, all but the hover zone is out of the window; open, nothing is.
  const away = bottom ? `calc(100% - ${trigger})` : `calc(${trigger} - 100%)`;
  // The zone is the toolbox's border, so it would hang below the open rows.
  // Clipping cuts it off where the rows cover it (100% is rows plus zone);
  // clipped-off parts don't take the pointer. See zoneDepth.
  const cut = `calc(${OPENNESS} * clamp(0px, 100% - ${trigger}, ${trigger}))`;
  // The hidden toolbar's hover zone lets the pointer through in two cases
  // below. A toolbar held open by typing, a menu or a panel takes the pointer
  // back: pointer-events: auto in the open rule, which comes later with
  // selectors at least as specific. (Its plain :hover one is less specific,
  // but the pointer can't be on the toolbar and somewhere else at once.)
  //
  // A side tab bar runs the window's full height, so the zone lies over its
  // first (or last) tabs; while the pointer is on the tab bar the zone lets it
  // through to them.
  if (L.vertical) {
    const onTabBar = [":has(#sidebar-container:hover)", ":has(#tabbrowser-tabs[movingtab])", ":has(tab-group[movingtabgroup])"];
    blocks.push(`/* The hidden toolbar's hover zone doesn't cover a side tab bar in use. */
${rule(
  onTabBar.map((c) => `${HGUARD}${c} #navigator-toolbox`),
  ["pointer-events: none"],
)}`);
  }
  blocks.push(`/* Pointing at something clickable near the edge: the hover zone lets the
   pointer through to the page (see PAGE_ACTION). */
${rule(`${HGUARD}${PAGE_WANTS_POINTER} #navigator-toolbox`, ["pointer-events: none"])}`);
  blocks.push(`/* Toolbar auto-hide. The toolbox floats over the page and slides out of view,
   leaving only its transparent inner border (the hover zone) inside the
   window. translate percentages are relative to the toolbox's own height, so
   it hides exactly whatever rows it currently has. Open, the part of the zone
   below the rows is clipped off. */
${rule(TB, [
  "position: absolute",
  atEdge,
  "z-index: 200",
  "box-sizing: border-box",
  `border-${bottom ? "top" : "bottom"}: ${trigger} solid transparent`,
  "background-clip: padding-box",
  ...background,
  `translate: 0 calc((1 - ${OPENNESS}) * ${away})`,
  `clip-path: ${bottom ? `inset(${cut} 0 0 0)` : `inset(0 0 ${cut} 0)`}`,
  ...stateTransition(),
])}

${holdRule(HGUARD, "#navigator-toolbox")}

${rule(open, [...openState(), "pointer-events: auto"])}`);
  return blocks;
}

/**
 * At the bottom of the window the address bar's results would open below it,
 * off screen. Flip the popover and its joint background to open upward: the
 * input's background reaches up into the seam and the view's reaches down.
 */
function upwardUrlbarView() {
  const shadow = "var(--urlbar-joint-background-shadow-margin)";
  const overlap = "var(--urlbar-joint-background-overlap)";
  return `/* Address bar results open upward. */
${rule(`${HGUARD} #urlbar > .urlbarView:popover-open`, ["position-area: block-start center"])}

${rule(`${HGUARD} #urlbar[popover-open] > .urlbar-background`, [
  `inset-block-start: calc(-1 * ${overlap})`,
  "inset-block-end: calc(-1 * (var(--urlbar-background-overhang-open) + var(--urlbar-input-growth-open-block)))",
  "border-start-start-radius: 0",
  "border-start-end-radius: 0",
  "border-end-start-radius: var(--urlbar-background-border-top-radius-open)",
  "border-end-end-radius: var(--urlbar-background-border-top-radius-open)",
  `clip-path: inset(calc(${overlap} - var(--urlbar-input-growth-open-block)) calc(-1 * ${shadow}) calc(-1 * ${shadow}))`,
])}

${rule(`${HGUARD} #urlbar > .urlbarView > .urlbarView-background`, [
  `inset-block: calc(-1 * var(--urlbarView-joint-background-outset-block)) calc(-1 * var(--urlbarView-margin-block) - ${overlap})`,
  "border-radius: var(--urlbar-background-border-radius)",
  "border-end-start-radius: 0",
  "border-end-end-radius: 0",
  `clip-path: inset(calc(-1 * ${shadow}) calc(-1 * ${shadow}) ${overlap})`,
])}`;
}

// ---------------------------------------------------------------------------
// Toolbar and address bar look
// ---------------------------------------------------------------------------

/** Toolbar colors and the address bar's look. Theme choices emit nothing. */
function urlbarRules(s) {
  const blocks = [];

  const toolbar = [];
  if (s.toolbarBgCustom) toolbar.push(`background-color: ${s.toolbarBgColor}`, "background-image: none");
  if (s.toolbarIconCustom) toolbar.push(`color: ${s.toolbarIconColor}`, `--toolbarbutton-icon-fill: ${s.toolbarIconColor}`);
  if (toolbar.length) blocks.push(rule(":is(#nav-bar, #PersonalToolbar)", toolbar));

  // The address bar's tokens are declared on :root and again on the
  // <moz-urlbar> host itself, so they're overridden on #urlbar directly.
  const urlbar = [];
  if (s.urlbarHeightCustom) {
    blocks.push(rule(":root", [`--urlbar-height: ${s.urlbarHeight}px`]));
    urlbar.push(`--urlbar-height: ${s.urlbarHeight}px`);
  }
  if (s.urlbarBgCustom) {
    const c = s.urlbarBgColor;
    urlbar.push(
      `--urlbar-background-color: ${c}`,
      `--urlbar-background-color-focus: ${c}`,
      `--toolbar-field-background-color: ${c}`,
      `--toolbar-field-background-color-focus: ${c}`,
    );
  }
  if (s.urlbarTextCustom) {
    urlbar.push(`--toolbar-field-text-color: ${s.urlbarTextColor}`, `--toolbar-field-text-color-focus: ${s.urlbarTextColor}`);
  }
  if (s.urlbarFocusCustom) {
    urlbar.push(`--toolbar-field-border-color-focus: ${s.urlbarFocusColor}`, `--focus-outline-color: ${s.urlbarFocusColor}`);
  }
  if (s.urlbarRadiusCustom) {
    const r = `${s.urlbarRadius}px`;
    urlbar.push(
      `--urlbar-border-radius: ${r}`,
      `--urlbarview-border-radius: ${r}`,
      `--urlbar-inner-border-radius: max(0px, ${r} - 4px)`,
    );
  }
  if (s.urlbarFontCustom) urlbar.push(`font-size: ${s.urlbarFontSize}px`);
  if (urlbar.length) blocks.push(rule("#urlbar", urlbar));

  if (s.urlbarWidthCustom) {
    blocks.push(rule("#urlbar-container", [`max-width: ${s.urlbarMaxWidth}px`, "margin-inline: auto"]));
  }
  return blocks;
}

/**
 * The bookmarks toolbar's look. Firefox shows or hides it from a pref (see
 * firefoxPrefs). The toolbar's own look reaches it too, so these come after.
 */
function bookmarksRules(s) {
  // The repeated id outranks the auto-hiding toolbar's background, which
  // reaches the bar through #navigator-toolbox.
  const BAR = "#navigator-toolbox #PersonalToolbar#PersonalToolbar";
  const ITEM = "#PersonalToolbar toolbarbutton.bookmark-item";
  const bar = [];
  if (s.bookmarksBgCustom) bar.push(`background-color: ${s.bookmarksBgColor}`, "background-image: none");
  if (s.bookmarksTextCustom) bar.push(`color: ${s.bookmarksTextColor}`, `--toolbarbutton-icon-fill: ${s.bookmarksTextColor}`);
  // Firefox sizes a bookmark as its 16px icon plus this padding above and
  // below, which the bar's own height follows. A name in a bigger font than
  // the icon would stretch that, so the bookmarks get the height outright too.
  const item = [];
  if (s.bookmarksHeightCustom) {
    bar.push(`--bookmark-block-padding: ${(s.bookmarksHeight - 16) / 2}px`);
    item.push(`height: ${s.bookmarksHeight}px`, "padding-block: 0");
  }
  if (s.bookmarksFontCustom) item.push(`font-size: ${s.bookmarksFontSize}px`);

  const blocks = [];
  if (bar.length) blocks.push(rule(BAR, bar));
  if (item.length) blocks.push(rule(ITEM, item));
  if (s.bookmarksIconsOnly) {
    blocks.push(`/* Bookmarks as icons only. */
${rule(`${ITEM} > .toolbarbutton-text`, ["display: none"])}

${rule(`${ITEM} > .toolbarbutton-icon`, ["margin-inline-end: 0"])}`);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// The page's edges
// ---------------------------------------------------------------------------

/**
 * Firefox draws a thin line between its bars and the page, rounding the
 * corner beside a sidebar. Where the bars hide, the page reaches the window's
 * edge and the line would stay there on its own, so it goes, as it does in
 * Firefox's full screen.
 */
function pageEdgeRules(s) {
  const L = layout(s);
  // Firefox's own selector: a page in split view has a frame of its own.
  const PAGE = "#tabbrowser-tabpanels > :not(.split-view-panel) .browserContainer";
  const blocks = [];

  // The top edge is clear when no bar there stays shown, counting a bookmarks
  // bar that is shown only while Firefox isn't hiding it.
  const shown = L.stacks.top.filter((bar) => !L.hiding[bar] && !(bar === "bookmarks" && s.bookmarksVisibility === "never"));
  const topClear = !shown.length ? HGUARD : shown.join() === "bookmarks" ? `${HGUARD}:has(${BOOKMARKS_COLLAPSED})` : null;
  if (topClear) {
    blocks.push(`/* The page reaches the top of the window: no line above it. */
${rule(`${topClear} ${PAGE}`, ["border-block-start: none", "border-start-start-radius: 0", "border-start-end-radius: 0"])}`);
  }

  // A sidebar panel (bookmarks, history) is outside the tab bar and stays.
  if (L.vertical && s.autoHide) {
    blocks.push(`/* The page reaches the side of the window: no line beside it. */
${rule(`${HGUARD} #tabbrowser-tabbox:not([sidebar-panel-open], [ai-window-open]) ${PAGE}`, [
  "border-inline: none",
  "border-start-start-radius: 0",
  "border-start-end-radius: 0",
])}`);
  }
  return blocks;
}
