import { currentVersion, storedUpdate } from "../shared/updates.js";

const update = await storedUpdate();
if (!update) window.close();

document.getElementById("new-version").textContent = update.version;
document.getElementById("current-version").textContent = currentVersion();
document.getElementById("download").textContent = `Download ${update.version}`;

async function open(url) {
  await browser.tabs.create({ url });
  window.close();
}

document.getElementById("download").addEventListener("click", () => open(update.download));
document.getElementById("notes").addEventListener("click", () => open(update.page));
document.getElementById("later").addEventListener("click", () => window.close());
