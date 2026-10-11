import { EASINGS, FIELDS, defaults, firefoxPrefs, isVertical, sanitize } from "../shared/settings.js";
import { generateCss } from "../shared/generate-css.js";

const HOST = "autohide_tab_bar";
// Matches the default "Match Firefox's tab height" closely enough for the preview.
const PREVIEW_AUTO_HEIGHT = 44;
const MAC_WINDOW_CONTROLS = 76;

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

let settings = defaults();
let currentHash = null;
let profileOverride = null;

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

/** "key", "!key", or alternatives joined with "|" (any one is enough). */
function requirementMet(expr) {
  return expr.split("|").some((part) => {
    const negate = part.startsWith("!");
    const value = Boolean(settings[negate ? part.slice(1) : part]);
    return negate ? !value : value;
  });
}

function updateDependents() {
  const orientation = isVertical(settings.position) ? "vertical" : "horizontal";
  for (const el of document.querySelectorAll("[data-show]")) {
    el.hidden = el.dataset.show !== orientation;
  }
  for (const el of document.querySelectorAll("[data-show-position]")) {
    el.hidden = el.dataset.showPosition !== settings.position || !requirementMet(el.dataset.showIf ?? "position");
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

function hexToRgba(hex, opacity) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity / 100})`;
}

function renderPreview() {
  const s = settings;
  const vertical = isVertical(s.position);
  const expanded = vertical ? s.expandedWidth : s.expandedHeightAuto ? PREVIEW_AUTO_HEIGHT : s.expandedHeight;
  const style = preview.style;
  const set = (prop, value) => (value == null ? style.removeProperty(prop) : style.setProperty(prop, value));

  // Tabs at the top sit in the toolbox above the nav row, as in Firefox.
  const bar = preview.querySelector(".pv-bar");
  if (s.position === "top") preview.querySelector(".pv-toolbox").prepend(bar);
  else preview.querySelector(".pv-window").insertBefore(bar, preview.querySelector(".pv-page"));

  preview.dataset.position = s.position;
  preview.classList.toggle("overlay", s.overlay);
  preview.classList.toggle("static", !s.autoHide);
  preview.classList.toggle("tb-autohide", s.toolbarAutoHide);
  preview.classList.toggle("tabs-in-toolbox", s.position === "top" && s.toolbarAutoHide);
  preview.classList.toggle("shadow", s.autoHide && s.shadow);
  preview.classList.toggle("reduced", s.reducedMotion);
  preview.classList.toggle("hold", holdOpen.checked);

  set("--c", `${s.collapsedSize}px`);
  set("--x", `${expanded}px`);
  set("--t", `${s.triggerSize}px`);
  set("--d", `${s.duration}ms`);
  set("--e", EASINGS.find((e) => e.id === s.easing).css);
  set("--od", `${s.openDelay}ms`);
  set("--cd", `${s.closeDelay}ms`);
  set("--bar-bg", s.backgroundCustom ? hexToRgba(s.backgroundColor, s.backgroundOpacity) : null);
  set("--bar-text", s.textCustom ? s.textColor : null);
  set("--sel", s.selectedCustom ? s.selectedColor : null);
  set("--sel-text", s.selectedTextCustom ? s.selectedTextColor : null);
  set("--hov", s.hoverCustom ? s.hoverColor : null);
  set("--tab-radius", s.radiusCustom ? `${s.radius}px` : null);
  set("--zone", showZone.checked && (s.autoHide || s.toolbarAutoHide) ? "color-mix(in srgb, var(--accent) 30%, transparent)" : null);
  set(
    "--mac-pad",
    s.position === "top" && s.autoHide && s.overlay && !s.toolbarAutoHide ? `${MAC_WINDOW_CONTROLS}px` : null,
  );

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

function renderManual(css, prefs) {
  cssOutput.textContent = css;
  manualPrefs.textContent = Object.entries(prefs)
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");
}

async function contentHash(css, prefs) {
  const data = new TextEncoder().encode(`${css}\n${JSON.stringify(prefs)}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function refreshDerived() {
  const css = generateCss(settings);
  const prefs = firefoxPrefs(settings);
  renderManual(css, prefs);
  const hash = await contentHash(css, prefs);
  currentHash = hash;
  renderHelper();
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let saveTimer = null;
let indicatorTimer = null;

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

function onSettingsChanged() {
  updateDependents();
  renderPreview();
  refreshDerived();
  scheduleSave();
}

// ---------------------------------------------------------------------------
// Helper (native messaging)
// ---------------------------------------------------------------------------

class HostReplyError extends Error {}

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

async function setProfileOverride(path) {
  profileOverride = path && path !== hostStatus?.runningProfile ? path : null;
  await browser.storage.local.set({ profileOverride });
}

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

function status(kind, ...children) {
  return h("div", { class: `status ${kind}` }, h("div", {}, ...children));
}

function quitHint() {
  return hostStatus?.platform === "Darwin"
    ? "Quit Firefox completely (⌘Q) and open it again."
    : "Quit Firefox completely (Menu → Quit) and open it again.";
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
    out.push(status("ok", h("p", {}, "Removed. Restart Firefox to get its normal tab bar back."), h("p", { class: "sub" }, quitHint())));
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
  return out;
}

function renderHelper() {
  const nodes = [];
  if (helper === "checking") {
    nodes.push(status("info", h("p", {}, "Connecting to the helper…")));
  } else if (helper === "missing") {
    nodes.push(
      status(
        "warn",
        h("p", {}, "The helper isn't installed yet."),
        h("p", { class: "sub" }, "Firefox only lets extensions change its tab bar through a small helper program. Install it once by running this from the project folder in a terminal:"),
        h("pre", { class: "code" }, "./native-host/install.sh"),
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

async function init() {
  setupControls();
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
