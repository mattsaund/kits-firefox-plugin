// Settings model shared by the options page, the CSS generator and the tests.
//
// Every value that reaches the generator goes through sanitize() first, so the
// generated CSS can interpolate settings directly without further escaping.

// Edges the tab bar can sit on. left/right use Firefox's vertical tabs,
// top/bottom its horizontal tab strip.
export const POSITIONS = ["left", "right", "top", "bottom"];

// Animation styles offered on the settings page, with the CSS each one emits.
export const EASINGS = [
  { id: "ease", label: "Smooth", css: "ease" },
  { id: "ease-in-out", label: "Gentle", css: "ease-in-out" },
  { id: "snappy", label: "Snappy", css: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
  { id: "linear", label: "Linear", css: "linear" },
  { id: "bouncy", label: "Bouncy", css: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
];

// Three-way choice for settings backed by a Firefox pref.
export const TRI = ["keep", "on", "off"];

// The horizontal bars, which stack up when they share an edge.
export const BARS = ["tabs", "toolbar", "bookmarks"];

/** Every arrangement of a list. */
function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((item, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map((rest) => [item, ...rest]));
}

// The order of bars sharing an edge, top to bottom, as "tabs,toolbar,bookmarks".
export const BAR_ORDERS = permutations(BARS).map((order) => order.join(","));

// Field builders: each field knows its type, its limits and its default.
const int = (min, max, def) => ({ type: "int", min, max, default: def });
const bool = (def) => ({ type: "bool", default: def });
const color = (def) => ({ type: "color", default: def });
const oneOf = (values, def) => ({ type: "enum", values, default: def });

// Widest hover zone, for the tab bar and the toolbar. The zone sits over the
// page edge and takes its clicks, so much more than this would be in the way.
const MAX_HOVER_ZONE = 100;

// Defaults reproduce the original hand-written userChrome.css's layout, with
// every color left to the Firefox theme.
export const FIELDS = {
  position: oneOf(POSITIONS, "left"),
  // Bars on the same edge, top to bottom. Firefox's own is tabs, toolbar, bookmarks.
  barOrder: oneOf(BAR_ORDERS, "tabs,toolbar,bookmarks"),

  autoHide: bool(true),
  // true: the bar slides over the page. false: the page shrinks to make room.
  overlay: bool(true),

  // Visible thickness while collapsed (also the space permanently taken from the page).
  collapsedSize: int(0, 48, 0),
  // Width of the bar when open, for left/right.
  expandedWidth: int(80, 600, 175),
  // Height of the bar when open, for top/bottom. "Auto" follows Firefox's own tab height.
  expandedHeightAuto: bool(true),
  expandedHeight: int(24, 120, 44),
  // Height of the tabs themselves, for top/bottom.
  tabHeightCustom: bool(false),
  tabHeight: int(20, 60, 32),
  // Invisible strip past the visible edge that catches the pointer.
  triggerSize: int(0, MAX_HOVER_ZONE, 10),

  duration: int(0, 1000, 200),
  easing: oneOf(EASINGS.map((e) => e.id), "ease"),
  openDelay: int(0, 1000, 0),
  closeDelay: int(0, 2000, 150),
  reducedMotion: bool(true),

  backgroundCustom: bool(false),
  backgroundColor: color("#000000"),
  backgroundOpacity: int(10, 100, 100),
  textCustom: bool(false),
  textColor: color("#fbfbfe"),
  selectedCustom: bool(false),
  selectedColor: color("#42414d"),
  selectedTextCustom: bool(false),
  selectedTextColor: color("#ffffff"),
  hoverCustom: bool(false),
  hoverColor: color("#2b2a33"),
  edgeWidth: int(0, 6, 0),
  edgeColor: color("#5b5b66"),
  shadow: bool(false),
  radiusCustom: bool(false),
  radius: int(0, 20, 6),

  // Toolbar (the row with the address bar). Shares the animation settings above.
  toolbarPosition: oneOf(["top", "bottom"], "top"),
  toolbarAutoHide: bool(false),
  // The hidden toolbar keeps nothing visible but this strip, so it can't be 0.
  toolbarTriggerSize: int(2, MAX_HOVER_ZONE, 10),
  toolbarBgCustom: bool(false),
  toolbarBgColor: color("#1c1b22"),
  // Firefox's own toolbar buttons (back, forward, reload, menu...).
  toolbarIconCustom: bool(false),
  toolbarIconColor: color("#fbfbfe"),
  // Extensions' buttons on the toolbars too. Their icons are pictures, so this
  // draws each one as its shape in the color.
  toolbarIconExtensions: bool(false),

  // Address bar look
  urlbarBgCustom: bool(false),
  urlbarBgColor: color("#2b2a33"),
  urlbarTextCustom: bool(false),
  urlbarTextColor: color("#fbfbfe"),
  urlbarFocusCustom: bool(false),
  urlbarFocusColor: color("#7a5af8"),
  urlbarHeightCustom: bool(false),
  urlbarHeight: int(24, 56, 32),
  urlbarRadiusCustom: bool(false),
  urlbarRadius: int(0, 28, 8),
  urlbarFontCustom: bool(false),
  urlbarFontSize: int(10, 22, 14),
  urlbarWidthCustom: bool(false),
  urlbarMaxWidth: int(300, 2000, 800),

  // Bookmarks toolbar. Showing it is Firefox's own setting; "keep" leaves it alone.
  bookmarksVisibility: oneOf(["keep", "always", "newtab", "never"], "keep"),
  bookmarksPosition: oneOf(["top", "bottom"], "top"),
  bookmarksAutoHide: bool(false),
  bookmarksTriggerSize: int(2, MAX_HOVER_ZONE, 10),
  bookmarksBgCustom: bool(false),
  bookmarksBgColor: color("#2b2a33"),
  bookmarksTextCustom: bool(false),
  bookmarksTextColor: color("#fbfbfe"),
  // Height of each bookmark: Firefox's 16px icon plus padding above and below.
  bookmarksHeightCustom: bool(false),
  bookmarksHeight: int(18, 40, 24),
  bookmarksFontCustom: bool(false),
  bookmarksFontSize: int(9, 18, 12),
  // Bookmarks show only their icons, without names.
  bookmarksIconsOnly: bool(false),

  // Address bar behavior. These are Firefox prefs; "keep" leaves whatever the
  // user has set in Firefox untouched.
  urlbarFullUrls: oneOf(TRI, "keep"),
  urlbarSuggestions: oneOf(TRI, "keep"),
  urlbarNewTab: oneOf(TRI, "keep"),
  urlbarSearchTerms: oneOf(TRI, "keep"),
  // 0 = keep Firefox's setting.
  urlbarResults: int(0, 20, 0),
};

// Firefox's own layout: tabs, toolbar and bookmarks bar along the top in that
// order, none of them hiding. "Reset layout" on the settings page puts these
// over the current settings; looks and sizes stay as they are.
export const REGULAR_LAYOUT = {
  position: "top",
  autoHide: false,
  toolbarPosition: "top",
  toolbarAutoHide: false,
  bookmarksPosition: "top",
  bookmarksAutoHide: false,
  barOrder: "tabs,toolbar,bookmarks",
};

const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Every field at its default value. */
export function defaults() {
  return Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f.default]));
}

/** One value made valid for its field: clamped, checked, or the default. */
function clean(field, value) {
  switch (field.type) {
    case "int": {
      const n = typeof value === "string" ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n)) return field.default;
      return Math.min(field.max, Math.max(field.min, Math.round(n)));
    }
    case "bool":
      return typeof value === "boolean" ? value : field.default;
    case "color":
      return typeof value === "string" && COLOR_RE.test(value) ? value.toLowerCase() : field.default;
    case "enum":
      return field.values.includes(value) ? value : field.default;
  }
  throw new Error(`Unknown field type ${field.type}`);
}

/** Returns a complete, valid settings object. Unknown keys are dropped. */
export function sanitize(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const s = {};
  for (const [key, field] of Object.entries(FIELDS)) {
    s[key] = clean(field, src[key]);
  }
  // A bar that is 0px wide with a 0px hover strip could never be reopened.
  if (s.autoHide && s.collapsedSize + s.triggerSize < 2) {
    s.triggerSize = 2 - s.collapsedSize;
  }
  // Before 0.4.1 only the tabs had an order, above or below the toolbar, and
  // the bookmarks bar always sat with the toolbar.
  if (!BAR_ORDERS.includes(src.barOrder) && src.tabsAboveToolbar === false) {
    s.barOrder = "toolbar,bookmarks,tabs";
  }
  if (!FIELDS.bookmarksPosition.values.includes(src.bookmarksPosition)) {
    s.bookmarksPosition = s.toolbarPosition;
  }
  return s;
}

/** Whether a tab bar position uses Firefox's vertical tabs. */
export function isVertical(position) {
  return position === "left" || position === "right";
}

/**
 * Where the horizontal bars sit. The toolbar's edge holds the bars inside
 * Firefox's toolbox; bars on the other edge are separate strips there.
 *
 *   stacks:  for "top" and "bottom", the bars on that edge from the window's
 *            edge inward (the last one meets the page)
 *   hiding:  per bar, "own" (its own hover zone), "toolbar" (along with an
 *            auto-hiding toolbar) or null (always shown)
 *   groups:  per bar that hides on its own, the run of neighbours on its edge
 *            that also do; they open together, from the innermost one's zone
 */
export function barLayout(settings) {
  const s = sanitize(settings);
  const toolbarEdge = s.toolbarPosition;
  const edgeOf = { tabs: isVertical(s.position) ? null : s.position, toolbar: toolbarEdge, bookmarks: s.bookmarksPosition };
  const stacks = { top: [], bottom: [] };
  for (const bar of s.barOrder.split(",")) {
    if (edgeOf[bar]) stacks[edgeOf[bar]].push(bar);
  }
  // The order runs top to bottom; at the bottom the window's edge comes last.
  stacks.bottom.reverse();

  const ownSwitch = { tabs: s.autoHide, toolbar: s.toolbarAutoHide, bookmarks: s.bookmarksAutoHide };
  const hiding = {};
  for (const bar of BARS) {
    if (!edgeOf[bar]) hiding[bar] = null;
    else if (bar !== "toolbar" && edgeOf[bar] === toolbarEdge && s.toolbarAutoHide) hiding[bar] = "toolbar";
    else hiding[bar] = ownSwitch[bar] ? "own" : null;
  }

  const groups = {};
  for (const stack of Object.values(stacks)) {
    let run = [];
    for (const bar of [...stack, null]) {
      if (bar && bar !== "toolbar" && hiding[bar] === "own") {
        run.push(bar);
      } else {
        for (const member of run) groups[member] = run;
        run = [];
      }
    }
  }
  return {
    toolbarEdge,
    otherEdge: toolbarEdge === "top" ? "bottom" : "top",
    edgeOf,
    stacks,
    hiding,
    groups,
    /** Bars on the toolbar's edge, inside the toolbox. */
    inToolbox: (bar) => edgeOf[bar] === toolbarEdge,
    /** Bars on the other edge, as fixed strips. */
    fixed: stacks[toolbarEdge === "top" ? "bottom" : "top"],
  };
}

/**
 * The hover zones that lie over the page, as { edge, size } in px: the
 * transparent strips past a hidden bar's visible edge that catch the pointer
 * (see generate-css.js). The page script behind "Let clicks through to the
 * page" uses these to tell when the pointer is near one.
 */
export function edgeZones(settings) {
  const s = sanitize(settings);
  const L = barLayout(s);
  const zones = [];
  if (isVertical(s.position) && s.autoHide && s.triggerSize > 0) zones.push({ edge: s.position, size: s.triggerSize });
  const ownZone = { tabs: s.triggerSize, bookmarks: s.bookmarksTriggerSize };
  for (const edge of ["top", "bottom"]) {
    // An auto-hiding toolbar takes everything on its edge with it.
    if (edge === L.toolbarEdge && s.toolbarAutoHide) {
      zones.push({ edge, size: s.toolbarTriggerSize });
      continue;
    }
    // Otherwise the bar that meets the page reaches over it, if it hides.
    const inner = L.stacks[edge].at(-1);
    if (inner && L.hiding[inner] === "own" && ownZone[inner] > 0) zones.push({ edge, size: ownZone[inner] });
  }
  return zones;
}

/** The CSS timing function for an animation style id. */
export function easingCss(id) {
  return (EASINGS.find((e) => e.id === id) ?? EASINGS[0]).css;
}

/**
 * Firefox prefs the helper writes to user.js on Apply. Layout (vertical vs
 * horizontal tabs, sidebar side, title bar) has to come from prefs: CSS alone
 * can't move the tab strip between the sidebar and the toolbar. Firefox reads
 * them at the next start; once it has saved them, the helper drops them from
 * user.js again (see "settle"), so they apply once. The settings page lists
 * these before Apply.
 */
export function firefoxPrefs(settings) {
  const s = sanitize(settings);
  const vertical = isVertical(s.position);
  const prefs = {
    "toolkit.legacyUserProfileCustomizations.stylesheets": true,
    "sidebar.verticalTabs": vertical,
  };
  if (vertical) {
    prefs["sidebar.position_start"] = s.position === "left";
    // "always-show" keeps the tab strip mounted and at full width; the CSS
    // does the hiding. Firefox's own expand-on-hover would fight it.
    prefs["sidebar.visibility"] = "always-show";
  }
  if (s.toolbarPosition === "bottom") {
    // The window controls live in the toolbar, and macOS can't place its
    // native buttons at the bottom of a window. Firefox's own title bar keeps
    // them at the top. (The helper puts the default back when this goes away.)
    prefs["browser.tabs.inTitlebar"] = 0;
  }

  if (s.urlbarFullUrls !== "keep") {
    const trim = s.urlbarFullUrls === "off";
    prefs["browser.urlbar.trimURLs"] = trim;
    prefs["browser.urlbar.trimHttps"] = trim;
  }
  const toggles = {
    urlbarSuggestions: "browser.urlbar.suggest.searches",
    urlbarNewTab: "browser.urlbar.openintab",
    urlbarSearchTerms: "browser.urlbar.showSearchTerms.enabled",
  };
  for (const [key, pref] of Object.entries(toggles)) {
    if (s[key] !== "keep") prefs[pref] = s[key] === "on";
  }
  if (s.urlbarResults > 0) prefs["browser.urlbar.maxRichResults"] = s.urlbarResults;
  if (s.bookmarksVisibility !== "keep") prefs["browser.toolbars.bookmarks.visibility"] = s.bookmarksVisibility;
  return prefs;
}
