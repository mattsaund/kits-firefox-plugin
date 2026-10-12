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

// Field builders: each field knows its type, its limits and its default.
const int = (min, max, def) => ({ type: "int", min, max, default: def });
const bool = (def) => ({ type: "bool", default: def });
const color = (def) => ({ type: "color", default: def });
const oneOf = (values, def) => ({ type: "enum", values, default: def });

// Defaults reproduce the original hand-written userChrome.css.
export const FIELDS = {
  position: oneOf(POSITIONS, "left"),

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
  triggerSize: int(0, 40, 10),

  duration: int(0, 1000, 200),
  easing: oneOf(EASINGS.map((e) => e.id), "ease"),
  openDelay: int(0, 1000, 0),
  closeDelay: int(0, 2000, 150),
  reducedMotion: bool(true),

  backgroundCustom: bool(true),
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
  // With the tabs on the toolbar's edge: tab strip above (true) or below it.
  tabsAboveToolbar: bool(true),
  toolbarAutoHide: bool(false),
  // The hidden toolbar keeps nothing visible but this strip, so it can't be 0.
  toolbarTriggerSize: int(2, 40, 10),
  toolbarBgCustom: bool(false),
  toolbarBgColor: color("#1c1b22"),
  toolbarIconCustom: bool(false),
  toolbarIconColor: color("#fbfbfe"),

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

  // Address bar behavior. These are Firefox prefs; "keep" leaves whatever the
  // user has set in Firefox untouched.
  urlbarFullUrls: oneOf(TRI, "keep"),
  urlbarSuggestions: oneOf(TRI, "keep"),
  urlbarNewTab: oneOf(TRI, "keep"),
  urlbarSearchTerms: oneOf(TRI, "keep"),
  // 0 = keep Firefox's setting.
  urlbarResults: int(0, 20, 0),
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
  return s;
}

/** Whether a tab bar position uses Firefox's vertical tabs. */
export function isVertical(position) {
  return position === "left" || position === "right";
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
  return prefs;
}
