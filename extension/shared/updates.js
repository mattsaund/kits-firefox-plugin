// Checks GitHub for a newer release. Used by the background script (which
// announces updates) and the settings page (which shows them).

export const REPO = "mattsaund/kits-firefox-plugin";
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

const VERSION_RE = /^\d+\.\d+\.\d+$/;

// Asking GitHub for the latest release shows GitHub this computer's IP
// address and Firefox version. Mozilla counts that as technical data, so the
// check only runs with the user's consent: Firefox's built-in "technical and
// interaction data" choice, offered at install and in about:addons, and the
// switch on the settings page.
export const UPDATE_CHECK_CONSENT = { data_collection: ["technicalAndInteraction"] };

/** Whether the user has allowed update checks (false where the API is missing). */
export async function updateChecksAllowed() {
  try {
    return await browser.permissions.contains(UPDATE_CHECK_CONSENT);
  } catch {
    return false;
  }
}

/** This extension's version, from its manifest. */
export function currentVersion() {
  return browser.runtime.getManifest().version;
}

/** -1, 0 or 1, comparing "major.minor.patch" strings. */
export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

// Only ever link to this repo's own release pages and downloads.
function ownGithubUrl(url) {
  return typeof url === "string" && url.startsWith(`https://github.com/${REPO}/`) ? url : null;
}

/** The latest published release: { version, download, page }. */
async function fetchLatestRelease() {
  const response = await fetch(LATEST_RELEASE_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const release = await response.json();
  const version = String(release.tag_name ?? "").replace(/^v/, "");
  if (!VERSION_RE.test(version)) throw new Error(`Unexpected release tag ${release.tag_name}`);
  const page = ownGithubUrl(release.html_url) ?? RELEASES_PAGE;
  const xpi = (release.assets ?? []).find((asset) => asset.name?.endsWith(".xpi"));
  return { version, page, download: ownGithubUrl(xpi?.browser_download_url) ?? page };
}

/**
 * Checks GitHub and records the result in storage under "update" (the newer
 * release, or null). Returns the newer release or null.
 */
export async function checkForUpdate() {
  if (!(await updateChecksAllowed())) throw new Error("Update checks are turned off");
  const latest = await fetchLatestRelease();
  const update = compareVersions(latest.version, currentVersion()) > 0 ? latest : null;
  await browser.storage.local.set({ update, updateCheckedAt: Date.now() });
  return update;
}

/** The last recorded update, ignoring one that has since been installed. */
export async function storedUpdate() {
  const { update } = await browser.storage.local.get("update");
  const valid = typeof update?.version === "string" && VERSION_RE.test(update.version);
  return valid && compareVersions(update.version, currentVersion()) > 0 ? update : null;
}
