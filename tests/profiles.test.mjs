// Tests for saved profiles (extension/shared/profiles.js): what is kept, how
// names work and what a damaged store comes back as.
// Run: npm test

import { test } from "node:test";
import assert from "node:assert/strict";

import { MAX_NAME_LENGTH, MAX_PROFILES, profileMatches, profileName, sanitizeProfiles, saveProfile } from "../extension/shared/profiles.js";
import { defaults } from "../extension/shared/settings.js";

const BLACK = { id: "{9b84b6b4-07c4-4b4b-ba21-394d86f6e9ee}", name: "Black" };

test("a profile keeps the settings and the theme", () => {
  const settings = { ...defaults(), position: "top", toolbarAutoHide: true };
  const [work] = saveProfile([], { id: "a", name: "  Work  ", settings, theme: BLACK });
  assert.equal(work.name, "Work");
  assert.deepEqual(work.theme, BLACK);
  assert.ok(profileMatches(work, settings));
  assert.ok(!profileMatches(work, defaults()));
  // Without access to the themes there is no theme to keep.
  assert.equal(saveProfile([], { id: "b", name: "Home", settings, theme: null })[0].theme, null);
});

test("saving under a name already used replaces that profile, ignoring case", () => {
  let profiles = saveProfile([], { id: "a", name: "Work", settings: defaults(), theme: null });
  profiles = saveProfile(profiles, { id: "b", name: "Home", settings: defaults(), theme: null });
  profiles = saveProfile(profiles, { id: "c", name: "work", settings: { ...defaults(), position: "right" }, theme: BLACK });
  assert.deepEqual(profiles.map((p) => [p.id, p.name]), [["a", "work"], ["b", "Home"]]);
  assert.equal(profiles[0].settings.position, "right");
  assert.throws(() => saveProfile(profiles, { id: "d", name: "   ", settings: defaults(), theme: null }));
});

test("names are tidied and limited", () => {
  assert.equal(profileName("  a   lot\tof   space "), "a lot of space");
  assert.equal(profileName("x".repeat(200)).length, MAX_NAME_LENGTH);
  assert.equal(profileName(42), "");
});

test("a damaged store comes back as the valid profiles only", () => {
  const stored = [
    { id: "a", name: "Work", settings: { position: "diagonal", triggerSize: 9999 }, theme: { id: "t" } },
    { id: "", name: "No id" },
    { id: "b", name: "" },
    { id: "c", name: "WORK" },
    null,
    "junk",
  ];
  const profiles = sanitizeProfiles(stored);
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].settings.position, "left");
  assert.equal(profiles[0].settings.triggerSize, 100);
  assert.deepEqual(profiles[0].theme, { id: "t", name: "t" });
  assert.deepEqual(sanitizeProfiles(undefined), []);
  const many = Array.from({ length: MAX_PROFILES + 5 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
  assert.equal(sanitizeProfiles(many).length, MAX_PROFILES);
});
