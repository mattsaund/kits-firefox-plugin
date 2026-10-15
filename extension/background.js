// Opens the settings page from the toolbar button and on first install,
// checks for new releases twice a day if the user allows it, runs "Let clicks
// through to the page" when switched on, and once Firefox has taken in the
// settings from the last Apply, asks the helper to stop re-applying them at
// every start.

import { CLICK_THROUGH_ACCESS, SIGNALS, clickThroughAllowed } from "./shared/click-through.js";
import { edgeZones } from "./shared/settings.js";
import { checkForUpdate, storedUpdate, updateChecksAllowed } from "./shared/updates.js";

const CHECK_ALARM = "update-check";
const CHECK_EVERY_MINUTES = 12 * 60;
const SETTLE_ALARM = "settle-prefs";
const HOST = "autohide_tab_bar";

// The page script behind "Let clicks through to the page".
const CLICK_THROUGH_SCRIPT = {
  id: "click-through",
  js: ["content/click-through.js"],
  matches: CLICK_THROUGH_ACCESS.origins,
  runAt: "document_idle",
};

browser.action.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") browser.runtime.openOptionsPage();
  scheduleChecks();
  syncClickThrough();
});

browser.runtime.onStartup.addListener(() => {
  scheduleChecks();
  syncClickThrough();
  settlePrefs();
  // Firefox writes prefs.js some time after starting; try again shortly.
  browser.alarms.create(SETTLE_ALARM, { delayInMinutes: 2 });
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) runCheck();
  if (alarm.name === SETTLE_ALARM) settlePrefs();
});

// The user switched update checks or "Let clicks through to the page" on or
// off (settings page or about:addons).
browser.permissions.onAdded.addListener((added) => {
  if (added.data_collection?.includes("technicalAndInteraction")) scheduleChecks().then(runCheck);
  if (added.origins?.length) syncClickThrough({ openTabs: true });
});
browser.permissions.onRemoved.addListener((removed) => {
  if (removed.data_collection?.includes("technicalAndInteraction")) scheduleChecks();
  if (removed.origins?.length) syncClickThrough();
});

// Firefox doesn't always redraw the address bar's page actions on a tab
// switch, so a flag from the tab before could linger. Clearing the new tab's
// flag redraws them; its page script, told to start over, sets it again if
// the pointer needs it.
browser.tabs.onActivated.addListener(({ tabId }) => {
  flagTab(tabId, null);
  browser.tabs.sendMessage(tabId, { type: "click-through-reset" }).catch(() => {
    // No page script in that tab.
  });
  checkSeen(tabId);
});

// A page finished loading in the tab in front: it may be one the page script
// can't run in, or no longer be one.
browser.tabs.onUpdated.addListener(
  (tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.active) checkSeen(tabId);
  },
  { properties: ["status"] },
);

browser.runtime.onMessage.addListener((message, sender) => {
  // The settings page asks for a check with this message ("Check now"). It
  // shows what it finds in its own banner, so no popup for that version.
  if (message?.type === "check-for-update") return runCheck({ announce: false });
  // The page script asks where the hover zones are...
  if (message?.type === "click-through-zones") return clickThroughZones();
  // ...and says when the pointer is on something clickable near one.
  if (message?.type === "click-through" && sender.tab && sender.frameId === 0) {
    return flagTab(sender.tab.id, message.hold === true ? "hold" : null);
  }
});

async function scheduleChecks() {
  if (await updateChecksAllowed()) {
    // Alarms don't survive a browser restart, so this runs on every startup.
    browser.alarms.create(CHECK_ALARM, { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MINUTES });
  } else {
    await browser.alarms.clear(CHECK_ALARM);
  }
  await showBadge();
}

async function runCheck({ announce = true } = {}) {
  if (!(await updateChecksAllowed())) return null;
  let update = null;
  try {
    update = await checkForUpdate();
  } catch {
    // Offline or GitHub unavailable: keep whatever was known and try again later.
    update = await storedUpdate();
  }
  await showBadge();
  if (update && announce) await announceOnce(update);
  else if (update) await browser.storage.local.set({ announcedVersion: update.version });
  return update;
}

/**
 * The helper drops the prefs it wrote to user.js once this Firefox has loaded
 * and saved them, so they apply once instead of overriding Firefox's own
 * settings at every start. No helper installed is fine; nothing to do then.
 */
async function settlePrefs() {
  try {
    await browser.runtime.sendNativeMessage(HOST, { cmd: "settle" });
  } catch {
    // Helper missing or Firefox not ready; the next startup tries again.
  }
}

async function showBadge() {
  const update = (await updateChecksAllowed()) ? await storedUpdate() : null;
  await browser.action.setBadgeText({ text: update ? "1" : "" });
  await browser.action.setBadgeBackgroundColor({ color: "#6e4be6" });
  await browser.action.setTitle({
    title: update ? `Kits Editor for Firefox ${update.version} is available` : "Kits Editor for Firefox settings",
  });
}

/**
 * Registers the page script while "Let clicks through to the page" is on, and
 * removes it when it goes off. `openTabs` also starts it in pages already
 * open, which would otherwise only get it at their next load.
 */
async function syncClickThrough({ openTabs = false } = {}) {
  const ids = [CLICK_THROUGH_SCRIPT.id];
  const registered = (await browser.scripting.getRegisteredContentScripts({ ids })).length > 0;
  const tabs = await browser.tabs.query({});
  if (await clickThroughAllowed()) {
    if (!registered) await browser.scripting.registerContentScripts([CLICK_THROUGH_SCRIPT]);
    for (const tab of tabs) if (tab.active) checkSeen(tab.id);
    if (!openTabs) return;
    for (const tab of tabs) {
      // Firefox's own pages and addons.mozilla.org refuse; nothing to do there.
      browser.scripting.executeScript({ target: { tabId: tab.id }, files: CLICK_THROUGH_SCRIPT.js }).catch(() => {});
    }
  } else {
    if (registered) await browser.scripting.unregisterContentScripts({ ids });
    // Copies already running in open pages carry on until those reload, but
    // flagTab ignores them now; clear any flag they left.
    for (const tab of tabs) browser.pageAction.hide(tab.id).catch(() => {});
  }
}

/** The hover zones over the page, for the page script. */
async function clickThroughZones() {
  const { settings } = await browser.storage.local.get("settings");
  return edgeZones(settings ?? {});
}

// Flag changes run one after another, so a quick "on" then "off" can't land
// in the wrong order.
let flagQueue = Promise.resolve();

/** Runs one flag change after those before it. */
function queueFlag(change) {
  flagQueue = flagQueue.then(change).catch(() => {
    // The tab closed in the meantime.
  });
  return flagQueue;
}

/**
 * Flags a tab for the stylesheet, which looks for the tab's page action and
 * reads its title (see SIGNALS, and PAGE_ACTION in shared/generate-css.js):
 * "hold" while the pointer is on something clickable near an edge, "blind" on
 * a page the page script can't run in, null for neither. The icon itself is
 * never shown.
 */
function flagTab(tabId, signal) {
  return queueFlag(async () => {
    if (signal && (await clickThroughAllowed())) {
      await browser.pageAction.setTitle({ tabId, title: SIGNALS[signal] });
      await browser.pageAction.show(tabId);
    } else {
      await browser.pageAction.hide(tabId);
    }
  });
}

/**
 * Whether the page script can run in a tab's page, found out by running a
 * script that does nothing: Firefox refuses in other extensions' pages (a new
 * tab page such as Tabliss), its own pages and addons.mozilla.org. Those get
 * the "blind" flag; a page that can be seen into loses it.
 */
async function checkSeen(tabId) {
  if (!(await clickThroughAllowed())) return;
  try {
    await browser.scripting.executeScript({ target: { tabId }, func: () => true });
  } catch {
    flagTab(tabId, "blind");
    return;
  }
  queueFlag(async () => {
    if ((await browser.pageAction.getTitle({ tabId })) === SIGNALS.blind) await browser.pageAction.hide(tabId);
  });
}

/** Pops up the update window once per new version. */
async function announceOnce(update) {
  const { announcedVersion } = await browser.storage.local.get("announcedVersion");
  if (announcedVersion === update.version) return;
  await browser.storage.local.set({ announcedVersion: update.version });
  await browser.windows.create({
    type: "popup",
    url: browser.runtime.getURL("update/update.html"),
    width: 440,
    height: 280,
  });
}
