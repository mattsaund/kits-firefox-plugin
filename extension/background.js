// Opens the settings page from the toolbar button and on first install, and
// checks for new releases twice a day.

import { checkForUpdate, storedUpdate } from "./shared/updates.js";

const CHECK_ALARM = "update-check";
const CHECK_EVERY_MINUTES = 12 * 60;

browser.action.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") browser.runtime.openOptionsPage();
  scheduleChecks();
});

browser.runtime.onStartup.addListener(scheduleChecks);

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CHECK_ALARM) runCheck();
});

// The settings page asks for a check with this message ("Check for updates").
browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "check-for-update") return runCheck();
});

function scheduleChecks() {
  // Alarms don't survive a browser restart, so this runs on every startup.
  browser.alarms.create(CHECK_ALARM, { delayInMinutes: 1, periodInMinutes: CHECK_EVERY_MINUTES });
  showBadge();
}

async function runCheck() {
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

async function showBadge() {
  const update = await storedUpdate();
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
