// The settings page: the form, the live preview, the helper connection
// (Apply / Remove), the list of what Apply changes, and update checks.

import { EASINGS, FIELDS, defaults, easingCss, firefoxPrefs, isVertical, sanitize } from "../shared/settings.js";
import { generateCss, hexToRgba } from "../shared/generate-css.js";
import {
  REPO,
  UPDATE_CHECK_CONSENT,
  compareVersions,
  currentVersion,
  storedUpdate,
  updateChecksAllowed,
} from "../shared/updates.js";

// The native messaging helper's registered name (see native-host/install.sh).
const HOST = "autohide_tab_bar";

// One-line helper installers, shown when the helper is missing or outdated.
const DOWNLOAD = `https://github.com/${REPO}/releases/latest/download`;
const INSTALL_COMMANDS = {
  posix: `curl -fsSL ${DOWNLOAD}/install.sh | sh`,
  win: `irm ${DOWNLOAD}/install.ps1 | iex`,
};
// Set from runtime.getPlatformInfo() in init().
let onWindows = false;

/** The helper install command for this system. */
function installCommand() {
  return onWindows ? INSTALL_COMMANDS.win : INSTALL_COMMANDS.posix;
}

// Firefox's default tab height, for "Theme" tab thickness in the preview.
const PREVIEW_TAB_HEIGHT = 32;
// Room the preview leaves for the traffic lights, as the generated CSS does.
const MAC_WINDOW_CONTROLS = 76;

// Elements used throughout.

const form = document.getElementById("settings");
const preview = document.getElementById("preview");
const holdOpen = document.getElementById("hold-open");
const showZone = document.getElementById("show-zone");
const helperBox = document.getElementById("helper-box");
const applyButton = document.getElementById("apply");
const removeButton = document.getElementById("remove");
const resetButton = document.getElementById("reset");
const saveIndicator = document.getElementById("save-indicator");
const cssOutput = document.getElementById("css-output");
const manualPrefs = document.getElementById("manual-prefs");

// Page state.
let settings = defaults(); // the form's current, sanitized values
let currentHash = null; // hash of what Apply would write now, to spot unapplied changes
let profileOverride = null; // a profile picked by hand, or null for this Firefox's own

// Helper connection: "checking" | "missing" | "error" | "connected"
let helper = "checking";
let helperError = "";
let hostStatus = null;
let lastAction = null; // "applied" | "removed"
let busy = false;

// ---------------------------------------------------------------------------
// Small DOM helper (keeps dynamic text out of innerHTML)
// ---------------------------------------------------------------------------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

// ---------------------------------------------------------------------------
// Form <-> settings
// ---------------------------------------------------------------------------

/** Fills in the select menus and copies each number field's limits onto its inputs. */
function setupControls() {
  const easing = form.elements.easing;
  for (const e of EASINGS) easing.append(h("option", { value: e.id }, e.label));

  const results = form.elements.urlbarResults;
  results.append(h("option", { value: "0" }, "Firefox setting"));
  for (let n = 3; n <= FIELDS.urlbarResults.max; n++) results.append(h("option", { value: String(n) }, String(n)));

  for (const [name, field] of Object.entries(FIELDS)) {
    if (field.type !== "int") continue;
    for (const el of form.querySelectorAll(`[name="${name}"], [data-for="${name}"]`)) {
      el.min = field.min;
      el.max = field.max;
    }
  }
}

/** The form's values as a sanitized settings object. */
function readForm() {
  const raw = {};
  for (const [name, field] of Object.entries(FIELDS)) {
    const el = form.elements[name];
    if (!el) continue;
    if (field.type === "bool") {
      raw[name] = el instanceof RadioNodeList ? el.value === "true" : el.checked;
    } else if (field.type === "int") {
      raw[name] = Number(el.value);
    } else {
      raw[name] = el.value;
    }
  }
  return sanitize(raw);
}

/** Puts a settings object into the form; leaves a number box alone while it's being typed in. */
function writeForm(s) {
  for (const [name, field] of Object.entries(FIELDS)) {
    const el = form.elements[name];
    if (!el) continue;
    if (field.type === "bool") {
      if (el instanceof RadioNodeList) el.value = String(s[name]);
      else el.checked = s[name];
    } else {
      el.value = s[name];
    }
  }
  for (const num of form.querySelectorAll("[data-for]")) {
    if (document.activeElement !== num) num.value = s[num.dataset.for];
  }
}

/** Tab bar and toolbar on the same edge (tabs sit inside the toolbar area). */
function sharedEdge() {
  return !isVertical(settings.position) && settings.position === settings.toolbarPosition;
}

/** One term: "key", "!key" or "key=value". "sharedEdge" is derived. */
function termMet(term) {
  const negate = term.startsWith("!");
  const [key, expected] = (negate ? term.slice(1) : term).split("=");
  const value = key === "sharedEdge" ? sharedEdge() : settings[key];
  const met = expected === undefined ? Boolean(value) : String(value) === expected;
  return negate ? !met : met;
}

/** Terms joined with "&" (all needed), alternatives with "|" (any one is enough). */
function requirementMet(expr) {
  return expr.split("|").some((alternative) => alternative.split("&").every(termMet));
}

/** Shows, hides and disables rows according to the settings they depend on. */
function updateDependents() {
  const orientation = isVertical(settings.position) ? "vertical" : "horizontal";
  for (const el of document.querySelectorAll("[data-show]")) {
    el.hidden = el.dataset.show !== orientation;
  }
  for (const el of document.querySelectorAll("[data-show-if]")) {
    el.hidden = !requirementMet(el.dataset.showIf);
  }
  for (const row of form.querySelectorAll(".row[data-requires]")) {
    row.classList.toggle("disabled", !requirementMet(row.dataset.requires));
  }
  for (const el of form.querySelectorAll("input, select")) {
    let off = false;
    for (let n = el.closest("[data-requires]"); n && !off; n = n.parentElement?.closest("[data-requires]")) {
      off = !requirementMet(n.dataset.requires);
    }
    el.disabled = off;
  }
}

// ---------------------------------------------------------------------------
// Preview, generated CSS
// ---------------------------------------------------------------------------

/**
 * Updates the preview to match the settings: the layout through data
 * attributes and classes, sizes and colors through CSS custom properties
 * that options.css feeds into the same arithmetic as the generated CSS.
 */
function renderPreview() {
  const s = settings;
  const vertical = isVertical(s.position);
  const shared = sharedEdge();
  const tabHeight = s.tabHeightCustom ? s.tabHeight : PREVIEW_TAB_HEIGHT;
  // Firefox's strip is the tab height plus a 6px margin above and below.
  const autoHeight = tabHeight + 12;
  const expanded = vertical ? s.expandedWidth : s.expandedHeightAuto ? autoHeight : s.expandedHeight;
  const style = preview.style;
  const set = (prop, value) => (value == null ? style.removeProperty(prop) : style.setProperty(prop, value));

  // Tabs on the toolbar's edge sit inside the toolbox, above or below the nav
  // row, as in Firefox; otherwise they are their own row of the window.
  const bar = preview.querySelector(".pv-bar");
  const toolbox = preview.querySelector(".pv-toolbox");
  if (shared && s.tabsAboveToolbar) toolbox.prepend(bar);
  else if (shared) toolbox.append(bar);
  else preview.querySelector(".pv-window").insertBefore(bar, preview.querySelector(".pv-page"));

  // Layout and behavior.
  preview.dataset.position = s.position;
  preview.dataset.toolbar = s.toolbarPosition;
  preview.classList.toggle("overlay", s.overlay);
  preview.classList.toggle("static", !s.autoHide);
  preview.classList.toggle("tb-autohide", s.toolbarAutoHide);
  preview.classList.toggle("tabs-in-toolbox", shared && s.toolbarAutoHide);
  preview.classList.toggle("shadow", s.autoHide && s.shadow);
  preview.classList.toggle("reduced", s.reducedMotion);
  preview.classList.toggle("hold", holdOpen.checked);

  // Sizes and timing.
  set("--c", `${s.collapsedSize}px`);
  set("--x", `${expanded}px`);
  set("--t", `${s.triggerSize}px`);
  set("--tbt", `${s.toolbarTriggerSize}px`);
  set("--pv-tab-h", `${tabHeight}px`);
  set("--d", `${s.duration}ms`);
  set("--e", easingCss(s.easing));
  set("--od", `${s.openDelay}ms`);
  set("--cd", `${s.closeDelay}ms`);
  // Tab bar look; null falls back to the theme stand-ins in options.css.
  set("--bar-bg", s.backgroundCustom ? hexToRgba(s.backgroundColor, s.backgroundOpacity) : null);
  set("--bar-text", s.textCustom ? s.textColor : null);
  set("--sel", s.selectedCustom ? s.selectedColor : null);
  set("--sel-text", s.selectedTextCustom ? s.selectedTextColor : null);
  set("--hov", s.hoverCustom ? s.hoverColor : null);
  set("--tab-radius", s.radiusCustom ? `${s.radius}px` : null);
  set("--zone", showZone.checked && (s.autoHide || s.toolbarAutoHide) ? "color-mix(in srgb, var(--accent) 30%, transparent)" : null);
  // The strip slides over the nav row only when it sits above it at the top.
  const overNavRow = shared && s.position === "top" && s.tabsAboveToolbar;
  set("--mac-pad", overNavRow && s.autoHide && s.overlay && !s.toolbarAutoHide ? `${MAC_WINDOW_CONTROLS}px` : null);

  // Toolbar and address bar look.
  set("--tb-bg", s.toolbarBgCustom ? s.toolbarBgColor : null);
  set("--tb-icon", s.toolbarIconCustom ? s.toolbarIconColor : null);
  set("--url-bg", s.urlbarBgCustom ? s.urlbarBgColor : null);
  set("--url-text", s.urlbarTextCustom ? s.urlbarTextColor : null);
  set("--url-focus", s.urlbarFocusCustom ? s.urlbarFocusColor : null);
  set("--url-height", s.urlbarHeightCustom ? `${s.urlbarHeight}px` : null);
  set("--url-radius", s.urlbarRadiusCustom ? `${s.urlbarRadius}px` : null);
  set("--url-font", s.urlbarFontCustom ? `${s.urlbarFontSize}px` : null);
  set("--url-max", s.urlbarWidthCustom ? `${s.urlbarMaxWidth}px` : null);

  const w = s.edgeWidth;
  const edgeOffsets = { left: `-${w}px 0`, right: `${w}px 0`, top: `0 -${w}px`, bottom: `0 ${w}px` };
  set("--edge", w > 0 ? `inset ${edgeOffsets[s.position]} 0 0 ${s.edgeColor}` : null);
}

// Plain-language names for the prefs Apply can change (see firefoxPrefs).
// browser.urlbar.trimHttps always travels with trimURLs, so one line covers both.
const PREF_LABELS = {
  "toolkit.legacyUserProfileCustomizations.stylesheets": (v) => `Allow userChrome.css: ${v ? "on" : "off"}`,
  "sidebar.verticalTabs": (v) => `Vertical tabs: ${v ? "on" : "off"}`,
  "sidebar.position_start": (v) => `Sidebar side: ${v ? "left" : "right"}`,
  "sidebar.visibility": () => "Sidebar: always shown",
  "browser.tabs.inTitlebar": (v) => (v === 0 ? "Firefox's own title bar: on" : "Title bar: Firefox's default"),
  "browser.urlbar.trimURLs": (v) => `Show full addresses: ${v ? "off" : "on"}`,
  "browser.urlbar.suggest.searches": (v) => `Search suggestions in the address bar: ${v ? "on" : "off"}`,
  "browser.urlbar.openintab": (v) => `Open address bar results in a new tab: ${v ? "on" : "off"}`,
  "browser.urlbar.showSearchTerms.enabled": (v) => `Show search terms on results pages: ${v ? "on" : "off"}`,
  "browser.urlbar.maxRichResults": (v) => `Address bar results: ${v}`,
};

/** The list, next to the Apply button, of Firefox settings Apply will change. */
function renderApplyPrefs(prefs) {
  const items = Object.entries(prefs)
    .filter(([name]) => name in PREF_LABELS)
    .map(([name, value]) => h("li", { title: `${name} = ${value}` }, PREF_LABELS[name](value)));
  document.getElementById("apply-prefs").replaceChildren(...items);
}

/** The stylesheet and prefs shown in "Install manually". */
function renderManual(css, prefs) {
  cssOutput.textContent = css;
  manualPrefs.textContent = Object.entries(prefs)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");
}

/** A fingerprint of what Apply writes, stored by the helper to spot unapplied changes. */
async function contentHash(css, prefs) {
  const data = new TextEncoder().encode(`${css}\n${JSON.stringify(prefs)}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Regenerates everything derived from the settings: CSS, prefs, hash. */
async function refreshDerived() {
  const css = generateCss(settings);
  const prefs = firefoxPrefs(settings);
  renderManual(css, prefs);
  renderApplyPrefs(prefs);
  currentHash = await contentHash(css, prefs);
  renderHelper();
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let saveTimer = null;
let indicatorTimer = null;

/** Saves the settings shortly after the last change, and says so. */
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await browser.storage.local.set({ settings });
    saveIndicator.textContent = "Settings saved";
    saveIndicator.style.opacity = "1";
    clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => (saveIndicator.style.opacity = "0"), 1500);
  }, 300);
}

/** Everything that follows a settings change. */
function onSettingsChanged() {
  updateDependents();
  renderPreview();
  refreshDerived();
  scheduleSave();
}

// ---------------------------------------------------------------------------
// Helper (native messaging)
// ---------------------------------------------------------------------------

// The helper answered, but with an error (as opposed to not being reachable).
class HostReplyError extends Error {}

/** Sends one message to the helper, tracking whether it is installed and reachable. */
async function callHost(message) {
  let reply;
  try {
    reply = await browser.runtime.sendNativeMessage(HOST, message);
  } catch (e) {
    const text = String(e?.message ?? e);
    if (/No such native application/i.test(text)) {
      helper = "missing";
    } else {
      helper = "error";
      helperError = text;
    }
    throw e;
  }
  if (!reply?.ok) throw new HostReplyError(reply?.error || "The helper sent an empty reply.");
  helper = "connected";
  return reply;
}

/** Asks the helper what is installed where, and redraws the Apply card. */
async function refreshStatus() {
  try {
    hostStatus = await callHost({ cmd: "status", profile: profileOverride });
  } catch (e) {
    if (e instanceof HostReplyError && profileOverride) {
      // The chosen profile no longer exists; fall back to the running one.
      await setProfileOverride(null);
      return refreshStatus();
    }
    if (e instanceof HostReplyError) {
      helper = "error";
      helperError = e.message;
    }
  }
  renderHelper();
}

/** Remembers a hand-picked profile; picking this Firefox's own clears it. */
async function setProfileOverride(path) {
  profileOverride = path && path !== hostStatus?.runningProfile ? path : null;
  await browser.storage.local.set({ profileOverride });
}

/** Apply or Remove through the helper. */
async function runAction(action) {
  busy = true;
  renderHelper();
  try {
    if (action === "apply") {
      const css = generateCss(settings);
      const prefs = firefoxPrefs(settings);
      const hash = await contentHash(css, prefs);
      hostStatus = await callHost({ cmd: "apply", profile: profileOverride, css, prefs, hash });
    } else {
      hostStatus = await callHost({ cmd: "remove", profile: profileOverride });
    }
    lastAction = action === "apply" ? "applied" : "removed";
    helperError = "";
  } catch (e) {
    helperError = String(e?.message ?? e);
    lastAction = null;
  } finally {
    busy = false;
    renderHelper();
  }
}

/** A status message box; kind is ok, info, warn or error. */
function status(kind, ...children) {
  return h("div", { class: `status ${kind}` }, h("div", {}, ...children));
}

/** How to quit Firefox on this system. */
function quitHint() {
  const how = { Darwin: "⌘Q", Windows: "Menu → Exit" }[hostStatus?.platform] ?? "Menu → Quit";
  return `Quit Firefox completely (${how}) and open it again.`;
}

// Firefox restores the sidebar's own collapsed/expanded mode from the session,
// and no pref can force it, so coming from horizontal tabs it may start icons-only.
function iconsOnlyHint() {
  if (!isVertical(settings.position)) return null;
  return h("p", { class: "sub" }, "Seeing only tab icons, no titles? Click Firefox's sidebar button (left end of the toolbar) once. Firefox remembers it.");
}

/** True when the helper couldn't detect this Firefox's profile and none was picked. */
function needsProfileChoice() {
  return hostStatus?.profile.chosenBy === "guess";
}

/** The profile line under the status: a picker when there is a choice to make. */
function profileLine() {
  const st = hostStatus;
  const label = (p) => `${p.name}${p.path === st.runningProfile ? " (this Firefox)" : ""}`;
  if (st.profiles.length > 1 || needsProfileChoice()) {
    const select = h(
      "select",
      { "aria-label": "Firefox profile", onchange: async (e) => {
        await setProfileOverride(e.target.value);
        lastAction = null;
        refreshStatus();
      } },
      needsProfileChoice() && h("option", { value: "", selected: true, disabled: true }, "Choose a profile…"),
      st.profiles.map((p) =>
        h("option", { value: p.path, selected: !needsProfileChoice() && p.path === st.profile.path }, label(p)),
      ),
    );
    return h("div", { class: "profile-line" }, h("span", {}, "Profile:"), select);
  }
  return h("div", { class: "profile-line" }, h("span", {}, `Profile: ${label(st.profile)}`));
}

/** The status messages for a connected helper. */
function stateMessages() {
  const st = hostStatus;
  const inst = st.installed;
  const out = [];

  if (needsProfileChoice()) {
    out.push(
      status(
        "warn",
        h("p", {}, "Which Firefox profile is this?"),
        h("p", { class: "sub" }, "The helper couldn't tell which profile this Firefox is running. Pick it below (about:support lists it under Profile Folder)."),
      ),
    );
    return out;
  }

  if (lastAction === "removed" && !inst.cssFile) {
    out.push(
      status(
        "ok",
        h("p", {}, "Removed. Restart Firefox to get its normal tab bar back."),
        h("p", { class: "sub" }, quitHint()),
        st.titlebarLeftOn &&
          h(
            "p",
            { class: "sub" },
            "Firefox's own title bar stays on from the bottom toolbar. To turn it off, right-click the toolbar, choose Customize Toolbar and untick Title Bar.",
          ),
      ),
    );
  } else if (!inst.cssFile) {
    out.push(status("info", h("p", {}, "Not applied to this profile yet."), h("p", { class: "sub" }, "Press Apply when you like how the preview looks.")));
  } else if (currentHash && inst.hash !== currentHash) {
    out.push(status("warn", h("p", {}, "You have changes that aren't applied yet.")));
  } else if (st.restartPending) {
    out.push(
      status(
        "warn",
        h("p", {}, "Applied. Restart Firefox to see it."),
        h("p", { class: "sub" }, `${quitHint()} Your tabs come back if "Open previous windows and tabs" is on in Firefox Settings.`),
        iconsOnlyHint(),
      ),
    );
  } else if (!st.profile.isRunning) {
    out.push(status("ok", h("p", {}, `Applied to ${st.profile.name}. It takes effect the next time that profile starts.`)));
  } else {
    out.push(status("ok", h("p", {}, "Applied and active."), iconsOnlyHint()));
  }

  if (inst.cssFile && st.profile.isRunning && !st.restartPending && st.stylesheetsPref === false) {
    out.push(
      status(
        "error",
        h("p", {}, "Firefox has custom stylesheets turned off."),
        h("p", { class: "sub" }, "Open about:config and set toolkit.legacyUserProfileCustomizations.stylesheets to true, then restart Firefox."),
      ),
    );
  }

  // Helper changes ship in minor versions; a patch release of the extension
  // alone doesn't need a new helper, so only major.minor is compared.
  const minor = (version) => version.split(".").slice(0, 2).concat("0").join(".");
  if (compareVersions(minor(st.version), minor(currentVersion())) < 0) {
    out.push(
      status(
        "warn",
        h("p", {}, `The helper is from version ${st.version}. Update it by running the install command again:`),
        h("pre", { class: "code" }, installCommand()),
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

const updateCard = document.getElementById("update-card");
const checkUpdatesButton = document.getElementById("check-updates");
const updateChecksSwitch = document.getElementById("update-checks");
let shownUpdate = null;

/** The update switch, and the banner when a newer version is known. */
async function renderUpdate() {
  const allowed = await updateChecksAllowed();
  updateChecksSwitch.checked = allowed;
  shownUpdate = allowed ? await storedUpdate() : null;
  updateCard.hidden = !shownUpdate;
  if (shownUpdate) {
    document.getElementById("update-title").textContent = `Version ${shownUpdate.version} is available`;
    document.getElementById("update-download").textContent = `Download ${shownUpdate.version}`;
  }
}

document.getElementById("update-download").addEventListener("click", () => {
  if (shownUpdate) browser.tabs.create({ url: shownUpdate.download });
});
document.getElementById("update-notes").addEventListener("click", () => {
  if (shownUpdate) browser.tabs.create({ url: shownUpdate.page });
});

// Consent goes through Firefox's own data permission, so this switch and the
// one in about:addons are the same setting. permissions.request() has to be
// the first thing the click handler awaits, or Firefox refuses it.
updateChecksSwitch.addEventListener("change", async () => {
  if (updateChecksSwitch.checked) {
    updateChecksSwitch.checked = await browser.permissions.request(UPDATE_CHECK_CONSENT);
  } else {
    await browser.permissions.remove(UPDATE_CHECK_CONSENT);
  }
  renderUpdate();
});
browser.permissions.onAdded.addListener(renderUpdate);
browser.permissions.onRemoved.addListener(renderUpdate);

checkUpdatesButton.addEventListener("click", async () => {
  // Checking by hand is still a request to GitHub, so it needs the same consent.
  if (!updateChecksSwitch.checked && !(await browser.permissions.request(UPDATE_CHECK_CONSENT))) return;
  checkUpdatesButton.disabled = true;
  checkUpdatesButton.textContent = "Checking\u2026";
  let label;
  try {
    const update = await browser.runtime.sendMessage({ type: "check-for-update" });
    label = update ? `${update.version} is available` : "You're up to date";
  } catch {
    label = "Couldn't reach GitHub";
  }
  await renderUpdate();
  checkUpdatesButton.textContent = label;
  setTimeout(() => {
    checkUpdatesButton.textContent = "Check now";
    checkUpdatesButton.disabled = false;
  }, 3000);
});

/** Redraws the Apply card from the helper state. */
function renderHelper() {
  const nodes = [];
  if (helper === "checking") {
    nodes.push(status("info", h("p", {}, "Connecting to the helper…")));
  } else if (helper === "missing") {
    nodes.push(
      status(
        "warn",
        h("p", {}, "The helper isn't installed yet."),
        h("p", { class: "sub" }, `Firefox only lets extensions change its tab bar through a small helper program. Install it once by running this in ${onWindows ? "PowerShell" : "a terminal"}:`),
        h("pre", { class: "code" }, installCommand()),
        h("p", { class: "sub" }, "Or use the manual install below."),
      ),
    );
  } else if (helper === "error") {
    nodes.push(status("error", h("p", {}, "Couldn't talk to the helper."), h("p", { class: "sub" }, helperError)));
  } else if (hostStatus) {
    nodes.push(...stateMessages());
    if (helperError) nodes.push(status("error", h("p", {}, helperError)));
    nodes.push(profileLine());
  }
  if (helper === "missing" || helper === "error") {
    nodes.push(h("div", { class: "actions" }, h("button", { type: "button", class: "ghost", onclick: refreshStatus }, "Check again")));
  }
  helperBox.replaceChildren(...nodes);

  const connected = helper === "connected" && hostStatus && !needsProfileChoice();
  const inst = hostStatus?.installed;
  applyButton.disabled = !connected || busy;
  applyButton.textContent = busy ? "Working…" : inst?.cssFile ? "Apply changes" : "Apply";
  removeButton.hidden = !(connected && (inst.cssFile || inst.importLine || inst.userJs));
  removeButton.disabled = busy;
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

/** Two-step button: the first click arms it, the second within 4s runs it. */
function confirmable(button, armedLabel, run) {
  const idle = button.textContent;
  let timer = null;
  button.addEventListener("click", () => {
    if (!button.classList.contains("confirming")) {
      button.classList.add("confirming");
      button.textContent = armedLabel;
      timer = setTimeout(() => {
        button.classList.remove("confirming");
        button.textContent = idle;
      }, 4000);
      return;
    }
    clearTimeout(timer);
    button.classList.remove("confirming");
    button.textContent = idle;
    run();
  });
}

/** Shows text on a button for a moment. */
function flashLabel(button, text) {
  const idle = button.textContent;
  button.textContent = text;
  setTimeout(() => (button.textContent = idle), 1500);
}

applyButton.addEventListener("click", () => runAction("apply"));
confirmable(removeButton, "Click again to remove", () => runAction("remove"));
confirmable(resetButton, "Click again to reset everything", () => {
  settings = defaults();
  writeForm(settings);
  onSettingsChanged();
});

document.getElementById("copy-css").addEventListener("click", async (e) => {
  await navigator.clipboard.writeText(generateCss(settings));
  flashLabel(e.currentTarget, "Copied");
});

document.getElementById("download-css").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([generateCss(settings)], { type: "text/css" }));
  const a = h("a", { href: url, download: "userChrome.css" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

form.addEventListener("input", (e) => {
  const target = e.target;
  if (target.dataset.for) {
    // Typing in a number box: follow along only once the value is in range,
    // so "1" on the way to "150" doesn't snap to the minimum.
    const field = FIELDS[target.dataset.for];
    const n = Number(target.value);
    if (target.value === "" || !Number.isFinite(n) || n < field.min || n > field.max) return;
    form.elements[target.dataset.for].value = n;
  }
  settings = readForm();
  if (!target.dataset.for) writeForm(settings);
  onSettingsChanged();
});

form.addEventListener("change", (e) => {
  if (e.target.dataset.for) {
    // Leaving a number box: snap whatever was typed to a valid value.
    const name = e.target.dataset.for;
    const fixed = sanitize({ ...settings, [name]: Number(e.target.value) })[name];
    form.elements[name].value = fixed;
    e.target.value = fixed;
    settings = readForm();
    onSettingsChanged();
  }
});

form.addEventListener("submit", (e) => e.preventDefault());
holdOpen.addEventListener("change", renderPreview);
showZone.addEventListener("change", renderPreview);

// Pick up a freshly installed helper, or a restart, when the tab is revisited.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !busy) refreshStatus();
});

/** Loads the saved settings and connects to the helper. */
async function init() {
  setupControls();
  document.getElementById("version").textContent = currentVersion();
  onWindows = (await browser.runtime.getPlatformInfo()).os === "win";
  renderUpdate();
  const stored = await browser.storage.local.get(["settings", "profileOverride"]);
  settings = sanitize(stored.settings ?? {});
  profileOverride = stored.profileOverride ?? null;
  writeForm(settings);
  updateDependents();
  renderPreview();
  await refreshDerived();
  await refreshStatus();
}

init();
