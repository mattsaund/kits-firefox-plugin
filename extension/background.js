// Opens the settings page from the toolbar button and on first install,
// checks for new releases twice a day if the user allows it, and once Firefox
// has taken in the settings from the last Apply, asks the helper to stop
// re-applying them at every start.

import { checkForUpdate, storedUpdate, updateChecksAllowed } from "./shared/updates.js";

const CHECK_ALARM = "update-check";
const CHECK_EVERY_MINUTES = 12 * 60;
const SETTLE_ALARM = "settle-prefs";
const HOST = "autohide_tab_bar";

browser.action.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") browser.runtime.openOptionsPage();
  scheduleChecks();
});

browser.runtime.onStartup.addListener(() => {
  scheduleChecks();
  settlePrefs();
  // Firefox writes prefs.js some time after starting; try again shortly.
  browser.alarms.create(SETTLE_ALARM, { delayInMinutes: 2 });
});

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) runCheck();
  if (alarm.name === SETTLE_ALARM) settlePrefs();
});

// The user switched update checks on or off (settings page or about:addons).
browser.permissions.onAdded.addListener((added) => {
  if (added.data_collection?.includes("technicalAndInteraction")) scheduleChecks().then(runCheck);
});
browser.permissions.onRemoved.addListener((removed) => {
  if (removed.data_collection?.includes("technicalAndInteraction")) scheduleChecks();
});

// The settings page asks for a check with this message ("Check now").
browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "check-for-update") return runCheck();
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

async function runCheck() {
  if (!(await updateChecksAllowed())) return null;
  let update = null;
  try {
    update = await checkForUpdate();
  } catch {
    // Offline or GitHub unavailable: keep whatever was known and try again later.
    update = await storedUpdate();
  }
  await showBadge();
  if (update) await announceOnce(update);
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
