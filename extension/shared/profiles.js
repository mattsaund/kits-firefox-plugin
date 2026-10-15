// Saved profiles: named copies of the settings, each with the Firefox theme
// that was on when it was saved, kept in storage under "profiles". The
// settings page saves, loads and deletes them; loading one puts its settings
// in the form (Apply takes them to Firefox) and switches to its theme.

import { sanitize } from "./settings.js";

export const MAX_PROFILES = 50;
export const MAX_NAME_LENGTH = 60;

/** A profile name cleaned up for saving: trimmed and shortened, or "" if blank. */
export function profileName(name) {
  return typeof name === "string" ? name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME_LENGTH) : "";
}

/** The theme part of a profile: { id, name } of a Firefox theme, or null. */
function cleanTheme(theme) {
  if (!theme || typeof theme.id !== "string" || !theme.id) return null;
  return { id: theme.id, name: typeof theme.name === "string" ? theme.name : theme.id };
}

/** One stored profile made valid, or null if it can't be. */
function cleanProfile(raw) {
  const name = profileName(raw?.name);
  if (!name || typeof raw.id !== "string" || !raw.id) return null;
  return { id: raw.id, name, settings: sanitize(raw.settings), theme: cleanTheme(raw.theme) };
}

/** The stored profiles, valid ones only, at most MAX_PROFILES, names unique. */
export function sanitizeProfiles(raw) {
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const profile = cleanProfile(item);
    if (profile && !out.some((p) => p.id === profile.id || sameName(p.name, profile.name))) out.push(profile);
    if (out.length === MAX_PROFILES) break;
  }
  return out;
}

/** Whether two profile names are the same name, ignoring case. */
export function sameName(a, b) {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

/**
 * The profiles with one saved under a name: a new profile, or the one with
 * that name replaced in place. `id` is used for a new one.
 */
export function saveProfile(profiles, { id, name, settings, theme }) {
  const profile = cleanProfile({ id, name, settings, theme });
  if (!profile) throw new Error("A profile needs a name");
  const at = profiles.findIndex((p) => sameName(p.name, profile.name));
  if (at >= 0) return profiles.map((p, i) => (i === at ? { ...profile, id: p.id } : p));
  if (profiles.length >= MAX_PROFILES) throw new Error(`Up to ${MAX_PROFILES} profiles`);
  return [...profiles, profile];
}

/** Whether a profile holds exactly these settings. */
export function profileMatches(profile, settings) {
  return JSON.stringify(profile.settings) === JSON.stringify(sanitize(settings));
}
