// Turns settings into the userChrome stylesheet the helper installs.
//
// The mechanics generalize the original hand-written userChrome.css: the bar
// always reserves exactly --ahtb-collapsed of layout space, a transparent
// border of --ahtb-trigger reaches past its visible edge to catch the pointer,
// and a negative margin hands that border (and, in overlay mode, the extra
// size gained when opening) back to the page, so the page never reflows.
//
//   left/right: Firefox's vertical tabs, #sidebar-container
//   top/bottom: Firefox's horizontal tabs, #TabsToolbar
//
// Every declaration is !important: userChrome.css is a user sheet, and normal
// user declarations lose to Firefox's own (author-level) browser CSS.

import { easingCss, isVertical, sanitize } from "./settings.js";

export const PRODUCT_NAME = "Kits Firefox Editor";

// Context menus that can be opened from inside the bar. Firefox drops :hover
// while one is open, so these keep the bar expanded instead. The content area
// menu is deliberately absent: right-clicking the page should let it close.
const TAB_MENUS = ["#tabContextMenu", "#open-tab-group-context-menu", "#saved-tab-group-context-menu"];
const SIDEBAR_MENUS = [
  "#sidebar-context-menu",
  "#sidebar-bookmarks-context-menu",
  "#sidebar-history-context-menu",
  "#sidebar-opentabs-context-menu",
  "#sidebar-synced-tabs-context-menu",
];

// Horizontal rules stand down in fullscreen (Firefox auto-hides the toolbox
// itself there) and in Customize mode (the tab strip must stay editable).
const HGUARD = ":root:not([inFullscreen], [customizing])";

// Room for the window controls when the top bar slides over the nav bar: the
// macOS traffic lights at the start, Windows' minimize/maximize/close (three
// 46px caption buttons) at the end.
const MAC_WINDOW_CONTROLS = "76px";
const WINDOWS_WINDOW_CONTROLS = "138px";

const SHADOW_ON = "drop-shadow(0 0 12px rgba(0, 0, 0, 0.45))";
const SHADOW_OFF = "drop-shadow(0 0 0 rgba(0, 0, 0, 0))";

export function generateCss(input) {
  const s = sanitize(input);
  const blocks = [header(s), variables(s)];
  blocks.push(...(isVertical(s.position) ? verticalRules(s) : horizontalRules(s)));
  blocks.push(...appearanceRules(s));
  blocks.push(...toolbarRules(s));
  blocks.push(...urlbarRules(s));
  if (s.reducedMotion && (s.autoHide || s.toolbarAutoHide)) blocks.push(reducedMotionRule(s));
  return blocks.join("\n\n") + "\n";
}

function header(s) {
  const mode = !s.autoHide ? "always open" : s.overlay ? "auto-hide, overlay" : "auto-hide, push";
  return `/* ${PRODUCT_NAME}: tab bar on the ${s.position} (${mode}).
   Written by the ${PRODUCT_NAME} extension. Change settings there rather
   than editing this file; it is replaced every time you apply. */`;
}

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
}`;
}

function rule(selectors, declarations) {
  const sel = Array.isArray(selectors) ? selectors.join(",\n") : selectors;
  const body = declarations.map((d) => `  ${d} !important;`).join("\n");
  return `${sel} {\n${body}\n}`;
}

function transition(properties) {
  return [
    `transition-property: ${properties.join(", ")}`,
    "transition-duration: var(--ahtb-duration)",
    "transition-timing-function: var(--ahtb-easing)",
    // Closing waits out the grace period; the expanded rules swap in the open delay.
    "transition-delay: var(--ahtb-close-delay)",
  ];
}

/**
 * Selectors under which the bar should be open. `root` prefixes the
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
    // The tab group editor <panel> marks itself [panelopen] while shown.
    ":has(#tab-group-editor panel[panelopen])",
    // <menupopup> exposes no open state, but Gecko puts [_moz-menuactive] on
    // the highlighted item of an open menu; submenus are nested in the DOM so
    // they are covered too. The close delay bridges the moments when the
    // pointer sits on a separator or the menu has only just opened.
    `:has(:is(${menuList}) :is(menu, menuitem)[_moz-menuactive])`,
    `:has(:is(${menuList}):hover)`,
  ];
  const lead = root === ":root" ? "" : `${root} `;
  return [...self.map((c) => `${lead}${target}${c}`), ...outside.map((c) => `${root}${c} ${target}`)];
}

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

// ---------------------------------------------------------------------------
// Left / right: vertical tabs in #sidebar-container
// ---------------------------------------------------------------------------

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

  const props = ["min-width", "max-width", "margin-inline-start", "margin-inline-end"];
  if (s.shadow) props.push("filter");

  blocks.push(`/* Collapsed. Border box = collapsed + trigger; the trigger is a transparent
   border (still a hit target) and overflow clips to the padding box, so only
   the collapsed part is visible. The negative margin returns the trigger's
   space to the page. */
${rule(T, [
  "box-sizing: border-box",
  "min-width: calc(var(--ahtb-collapsed) + var(--ahtb-trigger))",
  "max-width: calc(var(--ahtb-collapsed) + var(--ahtb-trigger))",
  "overflow: hidden",
  "position: relative",
  "z-index: 100",
  "background-clip: padding-box",
  ...(s.shadow ? [`filter: ${SHADOW_OFF}`] : []),
  ...transition(props),
])}`);

  for (const { sel, inner } of sides) {
    blocks.push(
      rule(sel, [
        `border-inline-${inner}: var(--ahtb-trigger) solid transparent`,
        `margin-inline-${inner}: calc(-1 * var(--ahtb-trigger))`,
      ]),
    );
  }

  const open = sides.map(({ sel }) => expandedSelectors({ target: sel, menus }));
  blocks.push(`/* Expanded. */
${rule(open.flat(), [
  "min-width: calc(var(--ahtb-expanded) + var(--ahtb-trigger))",
  "max-width: calc(var(--ahtb-expanded) + var(--ahtb-trigger))",
  ...(s.shadow ? [`filter: ${SHADOW_ON}`] : []),
  "transition-delay: var(--ahtb-open-delay)",
])}`);

  if (s.overlay) {
    // (expanded + trigger) + (collapsed - expanded - trigger) = collapsed:
    // the footprint never changes, the bar just covers the page.
    sides.forEach(({ inner }, i) => {
      blocks.push(
        rule(open[i], [
          `margin-inline-${inner}: calc(var(--ahtb-collapsed) - var(--ahtb-expanded) - var(--ahtb-trigger))`,
        ]),
      );
    });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Top / bottom: horizontal tabs in #TabsToolbar
// ---------------------------------------------------------------------------

function horizontalRules(s) {
  const T = `${HGUARD} #TabsToolbar`;
  const top = s.position === "top";
  const blocks = [];

  if (top && s.toolbarAutoHide) {
    // Tabs at the top live inside the toolbox, which hides as a whole (see
    // toolbarRules); the strip itself only keeps a custom height.
    if (!s.expandedHeightAuto) {
      blocks.push(rule(T, ["min-height: var(--ahtb-expanded)", "max-height: var(--ahtb-expanded)"]));
    }
    return blocks;
  }

  // With horizontal tabs the window controls (and the window drag area) live in
  // the tab strip. Hiding or moving the strip would take them along, so they
  // move to the nav bar, which is where Firefox puts them for vertical tabs.
  const moveWindowControls = s.autoHide || !top;
  if (moveWindowControls) {
    blocks.push(`/* Window controls and dragging move to the nav bar, as with vertical tabs. */
${rule(`${HGUARD}[customtitlebar] #nav-bar > .titlebar-buttonbox-container`, ["display: flex"])}

${rule(`${T} > :is(.titlebar-buttonbox-container, .titlebar-spacer)`, ["display: none"])}

${rule(`${HGUARD}[customtitlebar] #nav-bar`, ["-moz-window-dragging: drag"])}`);
  }

  if (s.autoHide || !top) {
    // The toolbox is its own stacking context below the page (z-index 0 vs 2),
    // which would trap the bar underneath the content it is meant to cover.
    blocks.push(rule(`${HGUARD} #navigator-toolbox`, ["z-index: 3"]));
  }

  if (!s.autoHide) {
    if (top) {
      if (!s.expandedHeightAuto) {
        blocks.push(rule(T, ["min-height: var(--ahtb-expanded)", "max-height: var(--ahtb-expanded)"]));
      }
      return blocks;
    }
    blocks.push(
      rule(T, [
        "position: fixed",
        "inset: auto 0 0 0",
        "margin: 0",
        "box-sizing: border-box",
        "min-height: var(--ahtb-expanded)",
        "max-height: var(--ahtb-expanded)",
        "z-index: 10",
      ]),
      rule(`${HGUARD} #browser`, ["margin-bottom: var(--ahtb-expanded)"]),
    );
    return blocks;
  }

  const menus = TAB_MENUS;
  // Toolbar buttons in the strip (e.g. "List all tabs") mark themselves [open]
  // while their panel is showing.
  const extraSelf = [":has(toolbarbutton[open])"];
  const open = expandedSelectors({ root: HGUARD, target: "#TabsToolbar", menus, extraSelf });
  const props = top ? ["min-height", "max-height", "margin-bottom"] : ["min-height", "max-height"];
  if (s.shadow) props.push("filter");

  const shared = [
    "box-sizing: border-box",
    "min-height: calc(var(--ahtb-collapsed) + var(--ahtb-trigger))",
    "max-height: calc(var(--ahtb-collapsed) + var(--ahtb-trigger))",
    "background-clip: padding-box",
    "overflow: hidden",
    "z-index: 10",
    ...(s.shadow ? [`filter: ${SHADOW_OFF}`] : []),
    `transition-property: ${props.join(", ")}`,
    "transition-duration: var(--ahtb-duration)",
    "transition-timing-function: var(--ahtb-easing)",
    // The delay goes through a variable so toolbarRules can give a bottom bar
    // a second, independently timed transition.
    "--ahtb-tab-delay: var(--ahtb-close-delay)",
    "transition-delay: var(--ahtb-tab-delay)",
  ];

  if (top) {
    blocks.push(`/* Collapsed: same arithmetic as the side bars, along the vertical axis.
   The tabs stay pinned to the bar's bottom edge, so they slide down into view. */
${rule(T, [
  ...shared,
  "position: relative",
  "border-bottom: var(--ahtb-trigger) solid transparent",
  "margin-bottom: calc(-1 * var(--ahtb-trigger))",
])}`);
    if (s.overlay) {
      blocks.push(`/* Sliding over the nav bar: clear the window controls. */
@media (-moz-platform: macos) {
${indent(rule(`${HGUARD}[customtitlebar] #TabsToolbar`, [`padding-inline-start: ${MAC_WINDOW_CONTROLS}`]))}
}

@media (-moz-platform: windows) {
${indent(rule(`${HGUARD}[customtitlebar] #TabsToolbar`, [`padding-inline-end: ${WINDOWS_WINDOW_CONTROLS}`]))}
}`);
    }
  } else {
    blocks.push(`/* Collapsed: pinned to the bottom of the window. The tabs stay pinned to
   the bar's top edge, so they slide up into view. */
${rule(T, [...shared, "position: fixed", "inset: auto 0 0 0", "margin: 0", "border-top: var(--ahtb-trigger) solid transparent"])}

${rule(`${T} > .toolbar-items`, ["align-items: flex-start"])}`);
    blocks.push(
      rule(`${HGUARD} #browser`, [
        "margin-bottom: var(--ahtb-collapsed)",
        ...(s.overlay ? [] : transition(["margin-bottom"])),
      ]),
    );
  }

  blocks.push(`/* Expanded. */
${rule(open, [
  "min-height: calc(var(--ahtb-expanded) + var(--ahtb-trigger))",
  "max-height: calc(var(--ahtb-expanded) + var(--ahtb-trigger))",
  ...(s.shadow ? [`filter: ${SHADOW_ON}`] : []),
  "--ahtb-tab-delay: var(--ahtb-open-delay)",
])}`);

  if (top && s.overlay) {
    blocks.push(
      rule(open, ["margin-bottom: calc(var(--ahtb-collapsed) - var(--ahtb-expanded) - var(--ahtb-trigger))"]),
    );
  }

  if (!top && !s.overlay) {
    // The bar is position: fixed, so the page has to be shrunk explicitly.
    // :has() can't nest, so the bar's own conditions are restated from the root.
    const menuList = menus.join(", ");
    const pushOpen = [
      ":has(#TabsToolbar:hover)",
      ":has(#tabbrowser-tabs[movingtab])",
      ":has(tab-group[movingtabgroup])",
      ":has(#TabsToolbar toolbarbutton[open])",
      ":has(#tab-group-editor panel[panelopen])",
      `:has(:is(${menuList}) :is(menu, menuitem)[_moz-menuactive])`,
      `:has(:is(${menuList}):hover)`,
    ].map((c) => `${HGUARD}${c} #browser`);
    blocks.push(
      rule(pushOpen, ["margin-bottom: var(--ahtb-expanded)", "transition-delay: var(--ahtb-open-delay)"]),
    );
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Colors, edge line, corner radius
// ---------------------------------------------------------------------------

function hexToRgba(hex, opacityPercent) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return opacityPercent >= 100 ? hex : `rgba(${r}, ${g}, ${b}, ${opacityPercent / 100})`;
}

function appearanceRules(s) {
  const vertical = isVertical(s.position);
  const target = vertical ? "#sidebar-container" : "#TabsToolbar";
  const decls = [];
  const blocks = [];

  if (s.backgroundCustom) {
    decls.push(`background-color: ${hexToRgba(s.backgroundColor, s.backgroundOpacity)}`, "background-image: none");
  } else if (s.autoHide && s.overlay) {
    // The theme's toolbox color can be translucent (it is on macOS), which
    // would let the page show through an overlaid bar. Layer it over an opaque
    // base, the same way Firefox's own expand-on-hover sidebar does.
    decls.push(
      "background-color: light-dark(#e8e8e8, #202020)",
      "background-image: image(var(--toolbox-background-color))",
    );
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

function reducedMotionRule(s) {
  const targets = [];
  if (s.autoHide) {
    if (isVertical(s.position)) targets.push("#sidebar-container");
    else if (!(s.position === "top" && s.toolbarAutoHide)) targets.push(`${HGUARD} #TabsToolbar`);
    if (s.position === "bottom" && !s.overlay) targets.push(`${HGUARD} #browser`);
  }
  if (s.toolbarAutoHide) {
    targets.push(
      s.position === "bottom"
        ? `${HGUARD} #navigator-toolbox > :is(#nav-bar, #PersonalToolbar, #toolbar-menubar)`
        : `${HGUARD} #navigator-toolbox`,
    );
  }
  return `@media (prefers-reduced-motion: reduce) {
${indent(rule(targets, ["transition-duration: 0s"]))}
}`;
}

// ---------------------------------------------------------------------------
// Toolbar auto-hide: the whole toolbox (nav bar, bookmarks, tabs when on top)
// ---------------------------------------------------------------------------

function toolbarRules(s) {
  if (!s.toolbarAutoHide) return [];
  const TB = `${HGUARD} #navigator-toolbox`;
  const top = s.position === "top";
  const bottom = s.position === "bottom";
  const rows = ["#nav-bar", "#PersonalToolbar", "#toolbar-menubar", ...(top ? ["#TabsToolbar"] : [])];
  const inRows = `:is(${rows.join(", ")})`;
  const menuList = [...(top ? TAB_MENUS : []), "#toolbar-context-menu"].join(", ");

  const self = [
    // A bottom tab bar is still a descendant of the toolbox, so hovering it
    // must not count as hovering the toolbar.
    bottom ? ":hover:not(:has(#TabsToolbar:hover))" : ":hover",
    // Typing in the address bar, or keyboard focus anywhere in the toolbar.
    `:has(${inRows}:focus-within)`,
    // Address bar results, toolbar button panels and menus mark themselves [open].
    `:has(${inRows} [open]:not([open="false"]))`,
    // Windows and Linux: the menu bar Alt brings up (an auto-hiding one drops [inactive]).
    ':has(#toolbar-menubar[autohide="true"]:not([inactive]))',
    ...(top ? [":has(#tabbrowser-tabs[movingtab])", ":has(tab-group[movingtabgroup])"] : []),
  ];
  const outside = [
    ...(top ? [":has(#tab-group-editor panel[panelopen])"] : []),
    `:has(:is(${menuList}) :is(menu, menuitem)[_moz-menuactive])`,
    `:has(:is(${menuList}):hover)`,
  ];
  const open = [...self.map((c) => `${TB}${c}`), ...outside.map((c) => `${HGUARD}${c} #navigator-toolbox`)];

  const background = s.toolbarBgCustom
    ? [`background-color: ${s.toolbarBgColor}`, "background-image: none"]
    : ["background-color: light-dark(#e8e8e8, #202020)", "background-image: image(var(--toolbox-background-color))"];

  const blocks = [];

  if (bottom) {
    // A bottom tab bar is position: fixed inside the toolbox. Transforming the
    // toolbox would make it the bar's containing block (dragging the bar along,
    // and Firefox stops painting it), so here the toolbox stays put and its
    // rows are wiped in and out with clip-path instead.
    const ROWS = `${TB} > :is(#nav-bar, #PersonalToolbar, #toolbar-menubar)`;
    blocks.push(`/* Toolbar auto-hide (tab bar at the bottom). The toolbox floats over the
   page, transparent to the pointer; an invisible strip along the top edge
   catches the pointer and the rows are revealed with clip-path. */
${rule(TB, ["position: absolute", "inset: 0 0 auto 0", "z-index: 200", "pointer-events: none"])}

${rule(`${HGUARD} #TabsToolbar`, ["pointer-events: auto"])}

${rule(`${TB}::before`, [
  'content: ""',
  "position: absolute",
  "inset: 0 0 auto 0",
  "height: var(--ahtb-trigger)",
  "z-index: 1",
  "pointer-events: auto",
])}

${rule(ROWS, [
  ...background,
  "clip-path: inset(0 0 100% 0)",
  "pointer-events: none",
  ...transition(["clip-path"]),
])}

${rule(
  open.map((sel) => `${sel} > :is(#nav-bar, #PersonalToolbar, #toolbar-menubar)`),
  ["clip-path: inset(0 0 0 0)", "pointer-events: auto", "transition-delay: var(--ahtb-open-delay)"],
)}

${rule(
  open.map((sel) => `${sel}::before`),
  // Clipped parts of a row don't take the pointer, so the strip stays live
  // underneath until the rows have slid over it.
  ["z-index: -1"],
)}`);
    return blocks;
  }

  blocks.push(`/* Toolbar auto-hide. The toolbox floats over the page and slides up out of
   view, leaving only its transparent bottom border (the hover zone) inside
   the window. translate percentages are relative to the toolbox's own
   height, so it hides exactly whatever rows it currently has. */
${rule(TB, [
  "position: absolute",
  "inset: 0 0 auto 0",
  "z-index: 200",
  "box-sizing: border-box",
  "border-bottom: var(--ahtb-trigger) solid transparent",
  "background-clip: padding-box",
  ...background,
  "translate: 0 calc(var(--ahtb-trigger) - 100%)",
  ...transition(["translate"]),
])}

${rule(open, ["translate: 0 0", "transition-delay: var(--ahtb-open-delay)"])}`);
  return blocks;
}

// ---------------------------------------------------------------------------
// Toolbar and address bar look
// ---------------------------------------------------------------------------

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

function indent(text) {
  return text
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}
