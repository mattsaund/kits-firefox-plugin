#!/usr/bin/env python3
"""Native messaging helper for the Kits Editor for Firefox extension.

Firefox extensions can't touch files or restyle the browser UI, so the
extension sends its generated stylesheet here and this script installs it into
the Firefox profile:

  <profile>/chrome/autohide-tab-bar.css   owned outright, replaced on apply
  <profile>/chrome/userChrome.css         holds only a managed @import of it
  <profile>/user.js                       gains a managed block of prefs

Rules of the user's own in userChrome.css would override the extension's, so
apply sets them aside in userChrome.css.ahtb-backup and remove puts them back.
Anything else in user.js is left alone. Firefox starts the script once per
message (runtime.sendNativeMessage); it answers and exits.

Standard library only; Python 3.8+. macOS, Linux and Windows.
"""

import configparser
import glob
import json
import os
import platform
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import time

VERSION = "0.4.9"

CSS_FILENAME = "autohide-tab-bar.css"
BACKUP_SUFFIX = ".ahtb-backup"

IMPORT_BEGIN = "/* BEGIN Kits Editor for Firefox (managed by the extension) */"
IMPORT_END = "/* END Kits Editor for Firefox */"
IMPORT_BLOCK = '{}\n@import url("{}");\n{}\n'.format(IMPORT_BEGIN, CSS_FILENAME, IMPORT_END)

USERJS_BEGIN = "// BEGIN Kits Editor for Firefox (managed by the extension; edits inside are overwritten)"
USERJS_END = "// END Kits Editor for Firefox"

META_PREFIX = "/* ahtb-meta "
META_RE = re.compile(r"^/\* ahtb-meta (\{.*\}) \*/$")

MAX_CSS_BYTES = 512 * 1024

# The only prefs the extension may set. Anything else is rejected, so the
# helper can't be used as a general-purpose pref writer.
ALLOWED_PREFS = {
    "toolkit.legacyUserProfileCustomizations.stylesheets": (bool, None),
    "sidebar.verticalTabs": (bool, None),
    "sidebar.position_start": (bool, None),
    "sidebar.visibility": (str, {"always-show", "hide-sidebar", "expand-on-hover"}),
    "browser.urlbar.trimURLs": (bool, None),
    "browser.urlbar.trimHttps": (bool, None),
    "browser.urlbar.suggest.searches": (bool, None),
    "browser.urlbar.openintab": (bool, None),
    "browser.urlbar.showSearchTerms.enabled": (bool, None),
    "browser.urlbar.maxRichResults": (int, range(1, 21)),
    "browser.toolbars.bookmarks.visibility": (str, {"always", "newtab", "never"}),
    # 0: Firefox's own title bar (for a bottom toolbar). -1: Firefox's default.
    "browser.tabs.inTitlebar": (int, {0, -1}),
}
TITLEBAR_PREF = "browser.tabs.inTitlebar"


class HostError(Exception):
    """A request the helper refuses; reported back to the extension as an error."""


# ---------------------------------------------------------------------------
# Native messaging framing
# ---------------------------------------------------------------------------


def read_message(stream):
    """One message from Firefox: a 4-byte native-endian length, then UTF-8 JSON."""
    raw_len = stream.read(4)
    if len(raw_len) < 4:
        raise HostError("No message received")
    (length,) = struct.unpack("=I", raw_len)
    if length > 4 * MAX_CSS_BYTES:
        raise HostError("Message too large")
    data = stream.read(length)
    return json.loads(data.decode("utf-8"))


def write_message(stream, obj):
    """One reply to Firefox, framed the same way."""
    data = json.dumps(obj).encode("utf-8")
    stream.write(struct.pack("=I", len(data)))
    stream.write(data)
    stream.flush()


# ---------------------------------------------------------------------------
# Locating profiles
# ---------------------------------------------------------------------------


def firefox_root():
    """The folder holding profiles.ini on this system."""
    system = platform.system()
    if system == "Darwin":
        return os.path.expanduser("~/Library/Application Support/Firefox")
    if system == "Linux":
        # Newer Firefox keeps its profiles under XDG_CONFIG_HOME; older
        # installs, and those upgraded from them, under ~/.mozilla.
        config = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
        xdg_root = os.path.join(config, "mozilla", "firefox")
        if os.path.exists(os.path.join(xdg_root, "profiles.ini")):
            return xdg_root
        return os.path.expanduser("~/.mozilla/firefox")
    if system == "Windows":
        return os.path.join(os.environ["APPDATA"], "Mozilla", "Firefox")
    raise HostError("Unsupported platform: {}".format(system))


def list_profiles(root=None):
    """Profiles from profiles.ini, the install default first."""
    root = root or firefox_root()
    ini_path = os.path.join(root, "profiles.ini")
    if not os.path.exists(ini_path):
        return []
    ini = configparser.RawConfigParser()
    ini.optionxform = str  # keys are case-sensitive
    ini.read(ini_path, encoding="utf-8")

    def resolve(path, relative):
        return os.path.realpath(os.path.join(root, path) if relative else path)

    install_defaults = set()
    for section in ini.sections():
        if section.startswith("Install") and ini.has_option(section, "Default"):
            install_defaults.add(resolve(ini.get(section, "Default"), True))

    profiles = []
    for section in ini.sections():
        if not section.startswith("Profile") or not ini.has_option(section, "Path"):
            continue
        relative = ini.get(section, "IsRelative", fallback="1") == "1"
        path = resolve(ini.get(section, "Path"), relative)
        is_default = path in install_defaults or (
            not install_defaults and ini.get(section, "Default", fallback="0") == "1"
        )
        profiles.append(
            {"name": ini.get(section, "Name", fallback=os.path.basename(path)), "path": path, "isDefault": is_default}
        )
    profiles.sort(key=lambda p: not p["isDefault"])
    return profiles


def is_profile_dir(path):
    """Whether a folder looks like a Firefox profile (and not, say, the updater's lock folder)."""
    return os.path.isfile(os.path.join(path, "prefs.js")) or os.path.isfile(os.path.join(path, "times.json"))


def parent_pid(pid):
    """The parent of a process, via ps (macOS and Linux)."""
    try:
        out = subprocess.run(
            ["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True, text=True, timeout=5
        ).stdout.strip()
        return int(out) if out else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def open_files(pid):
    """Paths a process has open: /proc on Linux, lsof on macOS."""
    if os.path.isdir("/proc/{}/fd".format(pid)):
        paths = []
        for fd in glob.glob("/proc/{}/fd/*".format(pid)):
            try:
                paths.append(os.readlink(fd))
            except OSError:
                pass
        return paths
    lsof = shutil.which("lsof") or "/usr/sbin/lsof"
    try:
        out = subprocess.run(
            [lsof, "-n", "-P", "-p", str(pid), "-Fn"], capture_output=True, text=True, timeout=10
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [line[1:] for line in out.splitlines() if line.startswith("n")]


def process_start_time(pid):
    """When a process started, as a Unix timestamp (macOS and Linux)."""
    try:
        out = subprocess.run(
            ["ps", "-o", "lstart=", "-p", str(pid)],
            capture_output=True,
            text=True,
            timeout=5,
            env=dict(os.environ, LC_ALL="C"),
        ).stdout.strip()
        return time.mktime(time.strptime(" ".join(out.split()), "%a %b %d %H:%M:%S %Y"))
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def windows_running_profiles(profiles):
    """Profiles a Firefox process currently holds open, on Windows.

    Firefox keeps <profile>/parent.lock open with no sharing for as long as it
    runs, so opening it fails with a sharing violation (PermissionError). The
    file itself outlives the browser and is rewritten at every start, so its
    modification time is when that Firefox started.
    """
    running = []
    for profile in profiles:
        lock = os.path.join(profile["path"], "parent.lock")
        if not os.path.exists(lock):
            continue
        try:
            with open(lock, "rb"):
                pass  # openable: left behind by a Firefox that has quit
        except PermissionError:
            running.append({"path": profile["path"], "pid": None, "startedAt": os.stat(lock).st_mtime})
        except OSError:
            continue
    return running


def running_firefox(profiles=()):
    """The profile of the Firefox that launched us: {"path", "pid", "startedAt"} or None.

    macOS and Linux: Firefox holds a lock on <profile>/.parentlock while it
    runs, so the first ancestor process with one open is the browser and that
    directory is its profile. Windows has no lsof to ask, so there it is the
    one locked profile; with several Firefox profiles running at once it is
    left undecided and the settings page asks.
    """
    if platform.system() == "Windows":
        running = windows_running_profiles(profiles)
        return running[0] if len(running) == 1 else None

    pid = os.getppid()
    for _ in range(4):
        if not pid or pid <= 1:
            break
        for path in open_files(pid):
            if os.path.basename(path) == ".parentlock":
                profile = os.path.realpath(os.path.dirname(path))
                if is_profile_dir(profile):
                    return {"path": profile, "pid": pid, "startedAt": process_start_time(pid)}
        pid = parent_pid(pid)
    return None


def all_profiles(ctx):
    """profiles.ini entries plus the running profile, which may not be listed
    there (e.g. Firefox started with -profile <dir>)."""
    profiles = list(ctx["profiles"])
    running = ctx["running"]
    if running and running["path"] not in {p["path"] for p in profiles}:
        profiles.insert(0, {"name": os.path.basename(running["path"]), "path": running["path"], "isDefault": False})
    return profiles


def choose_profile(requested, profiles, running):
    """Validate the profile the extension asked for, or pick the best default.

    "guess" means the running profile couldn't be detected; the profile shown
    is only a suggestion, and writes require an explicit choice.
    """
    known = {p["path"] for p in profiles}
    if running:
        known.add(running["path"])
    if requested:
        path = os.path.realpath(requested)
        if path not in known:
            raise HostError("Not a known Firefox profile: {}".format(requested))
        return path, "requested"
    if running:
        return running["path"], "running"
    if profiles:
        return profiles[0]["path"], "guess"
    raise HostError("No Firefox profile found")


def target_profile(msg, ctx):
    """Profile for a write. Never writes to a guessed profile."""
    profile, chosen_by = choose_profile(msg.get("profile"), ctx["profiles"], ctx["running"])
    if chosen_by == "guess":
        raise HostError("Couldn't tell which profile this Firefox is using. Choose it from the list first.")
    return profile


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------


def read_text(path):
    """A file's text, or None if it doesn't exist."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None


def write_atomic(path, text):
    """Writes a file via a temporary file and a rename, so it is never half-written."""
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".ahtb-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        if os.path.exists(path):
            shutil.copymode(path, tmp)
        else:
            os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def strip_block(text, begin, end):
    """Text with a managed block (begin marker through end marker) removed."""
    pattern = re.compile(r"[ \t]*" + re.escape(begin) + r".*?" + re.escape(end) + r"[ \t]*\n?", re.S)
    return pattern.sub("", text)


def own_rules(user_chrome):
    """What userChrome.css holds besides our import block: rules of the user's own."""
    return strip_block(user_chrome or "", IMPORT_BEGIN, IMPORT_END)


def merge_rules(older, newer):
    """Two sets of the user's own rules as one, older first, nothing repeated.

    Older helpers kept the user's rules in userChrome.css after taking a
    backup, so the newer set often already contains the older one.
    """
    if older is None or older.strip() in newer:
        return newer
    if newer.strip() in older:
        return older
    return older + ("" if older.endswith("\n") else "\n") + "\n" + newer


def set_aside_own_rules(path):
    """Moves the user's own rules out of userChrome.css into the backup file.

    They load after our stylesheet and win wherever they match it (a
    hand-written auto-hide sidebar from before, say), which breaks the bars in
    ways that look like bugs. The backup collects them and remove() puts them
    back.
    """
    rules = own_rules(read_text(path))
    if rules.strip():
        backup = path + BACKUP_SUFFIX
        write_atomic(backup, merge_rules(read_text(backup), rules))


def restore_own_rules(path):
    """Takes our import out of userChrome.css and puts back the rules apply()
    set aside, followed by any added since. The file goes if nothing is left.
    Returns whether set-aside rules came back."""
    backup = path + BACKUP_SUFFIX
    kept = read_text(backup)
    rules = merge_rules(kept, own_rules(read_text(path)))
    if rules.strip():
        write_atomic(path, rules)
    elif os.path.exists(path):
        os.unlink(path)
    if kept is not None:
        os.unlink(backup)
    return bool(kept and kept.strip())


def format_pref(name, value):
    """One user.js line; JSON quoting is valid for user.js values."""
    return "user_pref({}, {});".format(json.dumps(name), json.dumps(value))


def validate_prefs(prefs):
    """The prefs, if every one is on the allowlist with an allowed value."""
    if not isinstance(prefs, dict):
        raise HostError("prefs must be an object")
    for name, value in prefs.items():
        if name not in ALLOWED_PREFS:
            raise HostError("Pref not allowed: {}".format(name))
        kind, allowed = ALLOWED_PREFS[name]
        if type(value) is not kind or (allowed is not None and value not in allowed):
            raise HostError("Invalid value for {}".format(name))
    return prefs


def with_prefs(userjs, prefs):
    """user.js content with our managed block replaced by these prefs."""
    userjs = strip_block(userjs, USERJS_BEGIN, USERJS_END)
    if userjs and not userjs.endswith("\n"):
        userjs += "\n"
    lines = [USERJS_BEGIN] + [format_pref(k, v) for k, v in prefs.items()] + [USERJS_END]
    # Last in the file, so these win over earlier lines setting the same prefs.
    return userjs + "\n".join(lines) + "\n"


def read_meta(css_text):
    """The JSON on our stylesheet's first line (hash, apply time, prefs), or None."""
    if not css_text:
        return None
    first = css_text.split("\n", 1)[0]
    m = META_RE.match(first)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except ValueError:
        return None


def stylesheets_pref(profile):
    """Whether userChrome.css loading is on, as last saved to prefs.js (None if unset)."""
    prefs = read_text(os.path.join(profile, "prefs.js")) or ""
    m = re.search(r'user_pref\("toolkit\.legacyUserProfileCustomizations\.stylesheets",\s*(true|false)\);', prefs)
    return None if not m else m.group(1) == "true"


def profile_paths(profile):
    """The three files the helper manages in a profile."""
    chrome = os.path.join(profile, "chrome")
    return {
        "css": os.path.join(chrome, CSS_FILENAME),
        "userChrome": os.path.join(chrome, "userChrome.css"),
        "userJs": os.path.join(profile, "user.js"),
    }


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def status(msg, ctx):
    """What is installed in a profile, which Firefox is running, and whether a restart is due."""
    profile, chosen_by = choose_profile(msg.get("profile"), ctx["profiles"], ctx["running"])
    paths = profile_paths(profile)
    user_chrome = read_text(paths["userChrome"]) or ""
    user_js = read_text(paths["userJs"]) or ""
    meta = read_meta(read_text(paths["css"]))
    running = ctx["running"]
    is_running_profile = bool(running and running["path"] == profile)
    restart_pending = bool(
        meta
        and is_running_profile
        and running.get("startedAt")
        and meta.get("appliedAt", 0) > running["startedAt"]
    )
    profiles = all_profiles(ctx)
    return {
        "ok": True,
        "version": VERSION,
        "platform": platform.system(),
        "profile": {
            "path": profile,
            "name": next((p["name"] for p in profiles if p["path"] == profile), os.path.basename(profile)),
            "chosenBy": chosen_by,
            "isRunning": is_running_profile,
        },
        "runningProfile": running["path"] if running else None,
        "profiles": profiles,
        "installed": {
            "cssFile": meta is not None,
            "importLine": IMPORT_BEGIN in user_chrome,
            "otherRules": bool(own_rules(user_chrome).strip()),
            "userJs": USERJS_BEGIN in user_js,
            "hash": meta.get("hash") if meta else None,
            "appliedAt": meta.get("appliedAt") if meta else None,
        },
        "stylesheetsPref": stylesheets_pref(profile),
        "restartPending": restart_pending,
    }


def apply(msg, ctx):
    """Installs a stylesheet and prefs into a profile (the settings page's Apply)."""
    css = msg.get("css")
    if not isinstance(css, str) or not css.strip():
        raise HostError("css must be a non-empty string")
    if len(css.encode("utf-8")) > MAX_CSS_BYTES or "\0" in css:
        raise HostError("css rejected")
    if re.search(r"url\s*\(|@import", css, re.I):
        # The generator never produces either. Refusing them means the browser
        # UI stylesheet can't be made to load anything from anywhere.
        raise HostError("css must not load other files")
    prefs = validate_prefs(msg.get("prefs", {}))
    content_hash = msg.get("hash")
    if content_hash is not None and not (isinstance(content_hash, str) and re.fullmatch(r"[0-9a-f]{8,128}", content_hash)):
        raise HostError("Invalid hash")

    profile = target_profile(msg, ctx)
    paths = profile_paths(profile)
    previous = read_meta(read_text(paths["css"]))
    user_js = read_text(paths["userJs"]) or ""

    if forced_native_titlebar(previous, user_js) and TITLEBAR_PREF not in prefs:
        # We switched Firefox's own title bar on for a bottom toolbar; it's no
        # longer needed, so hand the choice back to Firefox's default.
        prefs = dict(prefs, **{TITLEBAR_PREF: -1})

    meta = {"hash": content_hash, "appliedAt": time.time(), "version": VERSION, "prefs": prefs}
    write_atomic(paths["css"], META_PREFIX + json.dumps(meta) + " */\n" + css)

    set_aside_own_rules(paths["userChrome"])
    write_atomic(paths["userChrome"], IMPORT_BLOCK)

    write_atomic(paths["userJs"], with_prefs(user_js, prefs))
    return status({"profile": profile}, ctx)


def forced_native_titlebar(meta, user_js):
    """Whether the last Apply turned Firefox's title bar on.

    Recorded in the stylesheet's meta line, since the user.js block that set
    it is dropped once Firefox has taken it in (see settle). Older versions
    only left it in the user.js block.
    """
    if meta and isinstance(meta.get("prefs"), dict):
        return meta["prefs"].get(TITLEBAR_PREF) == 0
    block = re.search(re.escape(USERJS_BEGIN) + r"(.*?)" + re.escape(USERJS_END), user_js, re.S)
    return bool(block and format_pref(TITLEBAR_PREF, 0) in block.group(1))


def settle(msg, ctx):
    """Stop re-applying the last Apply's prefs once Firefox has them.

    user.js is read at every start, so prefs left in it would undo any change
    made in Firefox's own settings. Once a Firefox that started after the
    Apply has written prefs.js, the values are saved there and the block can
    go: the prefs then apply once, and Firefox's settings work normally after.
    Only ever touches the profile of the Firefox that started the helper.
    """
    running = ctx["running"]
    if not running or not running.get("startedAt"):
        return {"ok": True, "settled": False}
    paths = profile_paths(running["path"])
    meta = read_meta(read_text(paths["css"]))
    user_js = read_text(paths["userJs"])
    prefs_js = os.path.join(running["path"], "prefs.js")
    if not meta or not user_js or USERJS_BEGIN not in user_js or not os.path.exists(prefs_js):
        return {"ok": True, "settled": False}
    loaded = running["startedAt"] > meta.get("appliedAt", float("inf"))
    saved = os.path.getmtime(prefs_js) > running["startedAt"]
    if not (loaded and saved):
        return {"ok": True, "settled": False}
    stripped = strip_block(user_js, USERJS_BEGIN, USERJS_END)
    if stripped.strip():
        write_atomic(paths["userJs"], stripped)
    else:
        os.unlink(paths["userJs"])
    return {"ok": True, "settled": True}


def remove(msg, ctx):
    """Takes everything apply() wrote back out of a profile."""
    profile = target_profile(msg, ctx)
    paths = profile_paths(profile)
    titlebar_left_on = forced_native_titlebar(read_meta(read_text(paths["css"])), read_text(paths["userJs"]) or "")

    if os.path.exists(paths["css"]):
        os.unlink(paths["css"])
    own_rules_restored = restore_own_rules(paths["userChrome"])
    user_js = read_text(paths["userJs"])
    if user_js is not None:
        stripped = strip_block(user_js, USERJS_BEGIN, USERJS_END)
        if stripped.strip():
            write_atomic(paths["userJs"], stripped)
        else:
            os.unlink(paths["userJs"])
    result = status({"profile": profile}, ctx)
    result["ownRulesRestored"] = own_rules_restored
    # Firefox keeps the last value of a pref user.js set; the settings page
    # says how to turn the title bar back off.
    result["titlebarLeftOn"] = titlebar_left_on
    return result


# The messages the extension can send.
COMMANDS = {"status": status, "apply": apply, "remove": remove, "settle": settle}


def handle(msg, ctx=None):
    """Runs one command. ctx (profiles and the running Firefox) is injectable for tests."""
    if ctx is None:
        profiles = list_profiles()
        ctx = {"profiles": profiles, "running": running_firefox(profiles)}
    if not isinstance(msg, dict) or msg.get("cmd") not in COMMANDS:
        raise HostError("Unknown command")
    return COMMANDS[msg["cmd"]](msg, ctx)


def main():
    """Reads one message, answers it, exits; errors become {"ok": false, "error": ...}."""
    stdin, stdout = sys.stdin.buffer, sys.stdout.buffer
    try:
        response = handle(read_message(stdin))
    except HostError as e:
        response = {"ok": False, "error": str(e)}
    except Exception as e:  # report instead of dying silently on the extension
        response = {"ok": False, "error": "{}: {}".format(type(e).__name__, e)}
    write_message(stdout, response)


if __name__ == "__main__":
    main()
