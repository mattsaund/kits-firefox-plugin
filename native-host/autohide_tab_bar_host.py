#!/usr/bin/env python3
"""Native messaging helper for the Auto-Hide Tab Bar extension.

Firefox extensions can't touch files or restyle the browser UI, so the
extension sends its generated stylesheet here and this script installs it into
the Firefox profile:

  <profile>/chrome/autohide-tab-bar.css   owned outright, replaced on apply
  <profile>/chrome/userChrome.css         gains a one-line managed @import
  <profile>/user.js                       gains a managed block of prefs

Anything else in userChrome.css and user.js is left alone. Firefox starts the
script once per message (runtime.sendNativeMessage); it answers and exits.

Standard library only; Python 3.8+.
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

VERSION = "1.0.0"

CSS_FILENAME = "autohide-tab-bar.css"
BACKUP_SUFFIX = ".ahtb-backup"

IMPORT_BEGIN = "/* BEGIN Auto-Hide Tab Bar (managed by the extension) */"
IMPORT_END = "/* END Auto-Hide Tab Bar */"
IMPORT_BLOCK = '{}\n@import url("{}");\n{}\n'.format(IMPORT_BEGIN, CSS_FILENAME, IMPORT_END)

USERJS_BEGIN = "// BEGIN Auto-Hide Tab Bar (managed by the extension; edits inside are overwritten)"
USERJS_END = "// END Auto-Hide Tab Bar"

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
}


class HostError(Exception):
    pass


# ---------------------------------------------------------------------------
# Native messaging framing
# ---------------------------------------------------------------------------


def read_message(stream):
    raw_len = stream.read(4)
    if len(raw_len) < 4:
        raise HostError("No message received")
    (length,) = struct.unpack("=I", raw_len)
    if length > 4 * MAX_CSS_BYTES:
        raise HostError("Message too large")
    data = stream.read(length)
    return json.loads(data.decode("utf-8"))


def write_message(stream, obj):
    data = json.dumps(obj).encode("utf-8")
    stream.write(struct.pack("=I", len(data)))
    stream.write(data)
    stream.flush()


# ---------------------------------------------------------------------------
# Locating profiles
# ---------------------------------------------------------------------------


def firefox_root():
    system = platform.system()
    if system == "Darwin":
        return os.path.expanduser("~/Library/Application Support/Firefox")
    if system == "Linux":
        return os.path.expanduser("~/.mozilla/firefox")
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
    return os.path.isfile(os.path.join(path, "prefs.js")) or os.path.isfile(os.path.join(path, "times.json"))


def parent_pid(pid):
    try:
        out = subprocess.run(
            ["ps", "-o", "ppid=", "-p", str(pid)], capture_output=True, text=True, timeout=5
        ).stdout.strip()
        return int(out) if out else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def open_files(pid):
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


def running_firefox():
    """The profile held open by the Firefox process that launched us.

    Firefox holds a lock on <profile>/.parentlock for as long as it runs, so
    the first ancestor process with one open is the browser and that directory
    is its profile. Returns {"path", "pid", "startedAt"} or None.
    """
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
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return None


def write_atomic(path, text):
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
    pattern = re.compile(r"[ \t]*" + re.escape(begin) + r".*?" + re.escape(end) + r"[ \t]*\n?", re.S)
    return pattern.sub("", text)


def with_import(css):
    """userChrome.css content with our @import block at the top.

    @import is only valid before every other rule (an @charset may precede
    it), so the block goes first. Keeping our rules in their own file also
    keeps them clear of any @namespace the user's own rules declare.
    """
    css = strip_block(css, IMPORT_BEGIN, IMPORT_END)
    charset = re.match(r'\s*@charset\s+"[^"]*"\s*;[ \t]*\n?', css)
    if charset:
        head = charset.group(0)
        if not head.endswith("\n"):
            head += "\n"
        return head + IMPORT_BLOCK + css[charset.end():]
    return IMPORT_BLOCK + css


def format_pref(name, value):
    return "user_pref({}, {});".format(json.dumps(name), json.dumps(value))


def validate_prefs(prefs):
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
    userjs = strip_block(userjs, USERJS_BEGIN, USERJS_END)
    if userjs and not userjs.endswith("\n"):
        userjs += "\n"
    lines = [USERJS_BEGIN] + [format_pref(k, v) for k, v in prefs.items()] + [USERJS_END]
    # Last in the file, so these win over earlier lines setting the same prefs.
    return userjs + "\n".join(lines) + "\n"


def read_meta(css_text):
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
    prefs = read_text(os.path.join(profile, "prefs.js")) or ""
    m = re.search(r'user_pref\("toolkit\.legacyUserProfileCustomizations\.stylesheets",\s*(true|false)\);', prefs)
    return None if not m else m.group(1) == "true"


def profile_paths(profile):
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
            "userJs": USERJS_BEGIN in user_js,
            "hash": meta.get("hash") if meta else None,
            "appliedAt": meta.get("appliedAt") if meta else None,
        },
        "stylesheetsPref": stylesheets_pref(profile),
        "restartPending": restart_pending,
    }


def apply(msg, ctx):
    css = msg.get("css")
    if not isinstance(css, str) or not css.strip():
        raise HostError("css must be a non-empty string")
    if len(css.encode("utf-8")) > MAX_CSS_BYTES or "\0" in css:
        raise HostError("css rejected")
    prefs = validate_prefs(msg.get("prefs", {}))
    content_hash = msg.get("hash")
    if content_hash is not None and not (isinstance(content_hash, str) and re.fullmatch(r"[0-9a-f]{8,128}", content_hash)):
        raise HostError("Invalid hash")

    profile = target_profile(msg, ctx)
    paths = profile_paths(profile)

    meta = {"hash": content_hash, "appliedAt": time.time(), "version": VERSION}
    write_atomic(paths["css"], META_PREFIX + json.dumps(meta) + " */\n" + css)

    user_chrome = read_text(paths["userChrome"])
    if user_chrome is not None and IMPORT_BEGIN not in user_chrome:
        backup = paths["userChrome"] + BACKUP_SUFFIX
        if not os.path.exists(backup):
            shutil.copy2(paths["userChrome"], backup)
    write_atomic(paths["userChrome"], with_import(user_chrome or ""))

    write_atomic(paths["userJs"], with_prefs(read_text(paths["userJs"]) or "", prefs))
    return status({"profile": profile}, ctx)


def remove(msg, ctx):
    profile = target_profile(msg, ctx)
    paths = profile_paths(profile)

    if os.path.exists(paths["css"]):
        os.unlink(paths["css"])
    for key, begin, end in (
        ("userChrome", IMPORT_BEGIN, IMPORT_END),
        ("userJs", USERJS_BEGIN, USERJS_END),
    ):
        text = read_text(paths[key])
        if text is None:
            continue
        stripped = strip_block(text, begin, end)
        if stripped.strip():
            write_atomic(paths[key], stripped)
        else:
            os.unlink(paths[key])
    return status({"profile": profile}, ctx)


COMMANDS = {"status": status, "apply": apply, "remove": remove}


def handle(msg, ctx=None):
    if ctx is None:
        ctx = {"profiles": list_profiles(), "running": running_firefox()}
    if not isinstance(msg, dict) or msg.get("cmd") not in COMMANDS:
        raise HostError("Unknown command")
    return COMMANDS[msg["cmd"]](msg, ctx)


def main():
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
