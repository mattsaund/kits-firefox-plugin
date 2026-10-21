// "Let clicks through to the page". Runs on web pages while that option is on
// (background.js registers it once Firefox grants access to websites).
//
// A hidden bar catches the pointer with a hover zone that lies over the edge
// of the page, so whatever the page has under the zone can't be clicked, and
// overshooting a link just below it opens the bar over that link. This script
// watches whether the pointer is on something clickable near an edge with a
// hover zone. While it is, the background script flags the tab and the
// stylesheet lets the pointer through the hover zones to the page (see
// PAGE_ACTION in shared/generate-css.js).
//
// It only looks at what is under the pointer, and only ever tells the
// extension's own background script "on" or "off".

(() => {
  // Open pages get the script injected when the option is switched on, and
  // may also load it from the registration; one copy is enough.
  if (globalThis.kitsClickThrough) return;
  globalThis.kitsClickThrough = true;

  // Clickable things within this distance past a hover zone count as near the
  // edge: the bar opening there would cover them. (px)
  const NEAR = 48;
  // The pointer only gets checked within this distance past a hover zone. (px)
  const WATCH = 200;
  // This close to a hover zone, what lies under the zone counts too, so
  // something inside the zone can be reached before the zone takes the pointer. (px)
  const REACH = 40;
  // Overshooting toward the edge, the pointer may stray this far to either side
  // of the clickable thing it came from and still count as heading for it. (px)
  const SLACK = 12;
  // ...and go this far past it toward the edge. Further than that, it is
  // heading for the bar instead, unless the thing is this close to the edge. (px)
  const OVERSHOOT = 24;
  // After the pointer moves off a clickable thing, the hover zones stay open to
  // the page this long, so crossing a gap between two links doesn't open the
  // bar. It counts from the moment the pointer moved off: moving on doesn't
  // put it off, or a pointer sliding slowly to empty space would hold the
  // zones open until it stopped. (ms)
  const GRACE = 250;
  // After the pointer leaves the page past a clickable thing by the edge, the
  // hover zones come back this long after. The wait covers overshooting past
  // the window edge (on macOS, into the menu bar above a maximized window) and
  // coming straight back. (ms)
  const AWAY = 800;
  // Resting in a hover zone this long, off anything clickable, opens the bar
  // after all. (ms)
  const DWELL = 700;
  // Things bigger than this share of the window are page-sized containers made
  // clickable as a whole, which would keep the bars shut everywhere.
  const MAX_SHARE = 0.4;

  const CLICKABLE = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "label",
    "[role=button]",
    "[role=link]",
    "[role=menuitem]",
    "[role=tab]",
    "[role=checkbox]",
    "[role=switch]",
    "[role=option]",
    "[role=combobox]",
    "[onclick]",
    "[contenteditable]:not([contenteditable=false])",
    "[tabindex]:not([tabindex='-1'])",
  ].join(", ");

  let zones = []; // [{ edge, size }] from the settings, see edgeZones()
  let held = false; // what the background script was last told
  let lane = null; // { edge, rect() }: the clickable thing being held for
  let releaseTimer = 0;
  let dwellTimer = 0;
  let dwellDone = false;
  let pointer = null; // the latest pointer position on the page

  // ---------------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------------

  /** How far a point is from an edge of the window. */
  function distance(edge, x, y) {
    if (edge === "top") return y;
    if (edge === "bottom") return innerHeight - y;
    if (edge === "left") return x;
    return innerWidth - x;
  }

  /** How far a box is from an edge of the window (negative past it). */
  function boxDistance(edge, r) {
    if (edge === "top") return r.top;
    if (edge === "bottom") return innerHeight - r.bottom;
    if (edge === "left") return r.left;
    return innerWidth - r.right;
  }

  /** The point in the middle of a hover zone, straight toward its edge from the pointer. */
  function pointInZone({ edge, size }, x, y) {
    const depth = Math.floor(size / 2);
    if (edge === "top") return [x, depth];
    if (edge === "bottom") return [x, innerHeight - 1 - depth];
    if (edge === "left") return [depth, y];
    return [innerWidth - 1 - depth, y];
  }

  /** How deep a box reaches into the page from an edge of the window. */
  function boxReach(edge, r) {
    return boxDistance(edge, r) + (edge === "top" || edge === "bottom" ? r.height : r.width);
  }

  /**
   * Where the pointer is next to a clickable thing near an edge: on it, just
   * past it toward the edge (all the way, for a thing by the edge), or slightly
   * beside or below it ("slack"), or else past it toward the edge, heading for
   * the bar ("past"), or somewhere else (null).
   */
  function laneAt({ edge, rect }, x, y) {
    const r = rect();
    const across = edge === "top" || edge === "bottom" ? x >= r.left - SLACK && x <= r.right + SLACK : y >= r.top - SLACK && y <= r.bottom + SLACK;
    const depth = distance(edge, x, y);
    if (!across || depth > boxReach(edge, r) + SLACK) return null;
    return depth >= boxDistance(edge, r) - OVERSHOOT ? "in" : "past";
  }

  /** Whether overshooting a clickable thing can carry the pointer right up to its edge. */
  function byTheEdge({ edge, rect }) {
    return boxDistance(edge, rect()) < OVERSHOOT;
  }

  // ---------------------------------------------------------------------------
  // What is clickable
  // ---------------------------------------------------------------------------

  /** The element at a point, looking inside open shadow roots. */
  function elementAt(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el?.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  /** The parent element, stepping out of shadow roots. */
  function parentOf(el) {
    return el.parentElement ?? el.getRootNode().host ?? null;
  }

  function pageSized(el) {
    const r = el.getBoundingClientRect();
    return r.width * r.height > MAX_SHARE * innerWidth * innerHeight;
  }

  /** The clickable element that `el` belongs to, if any. */
  function clickableFrom(el) {
    const stop = (node) => !node || node === document.body || node === document.documentElement;
    for (let node = el; !stop(node); node = parentOf(node)) {
      if (node.matches(CLICKABLE)) return pageSized(node) ? null : node;
    }
    // Plenty of sites make plain elements clickable with a script and give
    // them a pointer cursor. The cursor is inherited, so climb to the element
    // that set it.
    if (stop(el) || getComputedStyle(el).cursor !== "pointer") return null;
    let top = el;
    for (let node = parentOf(el); !stop(node) && getComputedStyle(node).cursor === "pointer"; node = parentOf(node)) {
      top = node;
    }
    return pageSized(top) ? null : top;
  }

  /**
   * What the pointer would click at a point, as a function returning its box
   * (boxes move when the page scrolls), or null. The page's own scrollbars
   * count; overlay scrollbars take no room and can't be told apart.
   */
  function targetAt(x, y) {
    const root = document.documentElement;
    if (root.clientWidth < innerWidth && x >= root.clientWidth) {
      return () => new DOMRect(root.clientWidth, 0, innerWidth - root.clientWidth, innerHeight);
    }
    if (root.clientHeight < innerHeight && y >= root.clientHeight) {
      return () => new DOMRect(0, root.clientHeight, innerWidth, innerHeight - root.clientHeight);
    }
    const el = clickableFrom(elementAt(x, y));
    return el ? () => el.getBoundingClientRect() : null;
  }

  // ---------------------------------------------------------------------------
  // Deciding
  // ---------------------------------------------------------------------------

  /** Tells the background script, once per change. */
  function send(hold) {
    if (held === hold) return;
    held = hold;
    browser.runtime.sendMessage({ type: "click-through", hold }).catch(() => {
      // The extension was updated or switched off; this copy is an orphan now.
    });
  }

  /**
   * Holds the hover zones open to the page, or lets them back after `delay`
   * ms. A release already on its way keeps its time (see GRACE).
   */
  function setHold(hold, delay = 0) {
    if (hold || delay === 0) {
      clearTimeout(releaseTimer);
      releaseTimer = 0;
      send(hold);
    } else if (held && !releaseTimer) {
      releaseTimer = setTimeout(() => {
        releaseTimer = 0;
        send(false);
      }, delay);
    }
  }

  function reset() {
    lane = null;
    clearTimeout(dwellTimer);
    dwellTimer = 0;
    dwellDone = false;
  }

  /** Looks at the pointer's position and holds or lets go. */
  function evaluate(x, y) {
    const watched = zones.filter((z) => distance(z.edge, x, y) < z.size + WATCH);
    if (!watched.length) {
      reset();
      setHold(false);
      return;
    }

    const target = targetAt(x, y);
    const inZone = watched.find((z) => distance(z.edge, x, y) < z.size);

    // Resting in a hover zone, off anything clickable, opens the bar after all.
    if (inZone && !target) {
      dwellTimer ||= setTimeout(() => {
        dwellDone = true;
        setHold(false);
      }, DWELL);
    } else {
      clearTimeout(dwellTimer);
      dwellTimer = 0;
      // Out of every zone's reach again: holding is possible once more.
      if (!watched.some((z) => distance(z.edge, x, y) < z.size + REACH)) dwellDone = false;
    }
    if (dwellDone) return;

    // On something clickable near an edge.
    if (target) {
      const near = watched.find((z) => boxDistance(z.edge, target()) < z.size + NEAR);
      if (near) {
        lane = { edge: near.edge, rect: target };
        setHold(true);
        return;
      }
    }
    // Overshooting from it toward the edge.
    const fromLane = lane && laneAt(lane, x, y);
    if (fromLane === "in") {
      setHold(true);
      return;
    }
    lane = null;
    // Almost at a hover zone with something clickable under it.
    for (const zone of watched) {
      if (distance(zone.edge, x, y) >= zone.size + REACH) continue;
      const underZone = targetAt(...pointInZone(zone, x, y));
      if (underZone) {
        lane = { edge: zone.edge, rect: underZone };
        setHold(true);
        return;
      }
    }
    // Gone well past it toward the edge, the pointer is after the bar: let it
    // through at once. Off to the side, it may be crossing to the next link.
    setHold(false, fromLane === "past" ? 0 : GRACE);
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  // Firefox already sends at most one pointermove per frame.
  function onPointerMove(e) {
    if (e.pointerType !== "mouse" || !zones.length) return;
    pointer = [e.clientX, e.clientY];
    evaluate(...pointer);
  }

  // Scrolling moves the page under a still pointer.
  function onScroll() {
    if (pointer && zones.length) evaluate(...pointer);
  }

  // The pointer left the page: out of the window, or onto Firefox's own UI.
  function onPointerOut(e) {
    if (e.relatedTarget && !/^(iframe|frame|object|embed)$/i.test(e.relatedTarget.localName)) return;
    pointer = null;
    if (e.relatedTarget) setHold(false, GRACE);
    else setHold(false, lane && byTheEdge(lane) ? AWAY : 0);
  }

  function stop() {
    pointer = null;
    reset();
    setHold(false);
  }

  async function loadZones() {
    try {
      const reply = await browser.runtime.sendMessage({ type: "click-through-zones" });
      zones = Array.isArray(reply) ? reply : [];
    } catch {
      zones = [];
    }
    if (!zones.length) stop();
  }

  addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
  addEventListener("scroll", onScroll, { capture: true, passive: true });
  document.addEventListener("pointerout", onPointerOut, { capture: true, passive: true });
  addEventListener("blur", stop);
  addEventListener("pagehide", stop);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  // The background script clears the flag when the tab becomes active again,
  // and Firefox does when a page comes back from the back/forward cache;
  // start over from there.
  browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "click-through-reset") held = false;
  });
  addEventListener("pageshow", () => (held = false));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) loadZones();
  });
  loadZones();
})();
