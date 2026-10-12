// "Let clicks through to the page" is on while Firefox grants the extension
// access to websites, which its page script (content/click-through.js) needs
// to see what is under the pointer. So the switch on the settings page and
// the website access switch in about:addons are the same setting.

export const CLICK_THROUGH_ACCESS = { origins: ["<all_urls>"] };

/** Whether the user has switched it on. */
export function clickThroughAllowed() {
  return browser.permissions.contains(CLICK_THROUGH_ACCESS);
}
