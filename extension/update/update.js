// The popup the background script opens once per new release: what's new,
// and a button that hands the release's .xpi to Firefox's own installer.

import { currentVersion, storedUpdate } from "../shared/updates.js";

/** Opens a page in a normal tab and closes the popup. */
async function open(url) {
  await browser.tabs.create({ url });
  window.close();
}

const update = await storedUpdate();

if (!update) {
  // Nothing newer known (already updated, or checks turned off). close()
  // doesn't stop the script, so the rest only runs when there is an update.
  window.close();
} else {
  document.getElementById("new-version").textContent = update.version;
  document.getElementById("current-version").textContent = currentVersion();
  const download = document.getElementById("download");
  download.textContent = `Download ${update.version}`;
  // A real link: Firefox only installs from a click on the page itself.
  download.href = update.download;

  document.getElementById("notes").addEventListener("click", () => open(update.page));
  document.getElementById("later").addEventListener("click", () => window.close());
}
