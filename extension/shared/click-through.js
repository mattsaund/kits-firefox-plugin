// "Let clicks through to the page" is on while Firefox grants the extension
// access to websites, which its page script (content/click-through.js) needs
// to see what is under the pointer. So the switch on the settings page and
// the website access switch in about:addons are the same setting.

export const CLICK_THROUGH_ACCESS = { origins: ["<all_urls>"] };

/**
 * What a tab's page action says to the stylesheet, as its title (Firefox
 * copies the title into the address bar icon's tooltiptext attribute, which
 * the stylesheet matches; see PAGE_ACTION in generate-css.js).
 *
 *   hold:  the pointer is on something clickable near an edge, so the hover
 *          zones let it through to the page.
 *   blind: the page script can't run here (another extension's page such as
 *          a new tab page, or one of Firefox's own), so nothing near the edge
 *          can be seen; the hover zones shrink to Kits' default 10px
 *          instead (BLIND_ZONE in generate-css.js).
 */
export const SIGNALS = {
  hold: "Kits: clicks go through",
  blind: "Kits: edge zones only",
};

/** Whether the user has switched it on. */
export function clickThroughAllowed() {
  return browser.permissions.contains(CLICK_THROUGH_ACCESS);
}
