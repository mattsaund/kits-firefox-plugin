"""Windows end-to-end check, run in CI.

Installs the helper with native-host/install.ps1 under Windows PowerShell,
then reaches it the way Firefox does (registry key -> manifest -> .bat ->
Python) against a fake profile held open like a running Firefox, applies and
removes a stylesheet, and uninstalls.
"""

import json
import os
import struct
import subprocess
import sys
import tempfile
import winreg

HERE = os.path.dirname(os.path.abspath(__file__))
INSTALL_PS1 = os.path.join(HERE, "..", "native-host", "install.ps1")
REGISTRY_KEY = r"Software\Mozilla\NativeMessagingHosts\autohide_tab_bar"
EXTENSION_ID = "autohide-tab-bar@kits"

sys.path.insert(0, HERE)
from winlock import FirefoxStyleLock  # noqa: E402


def powershell(*args):
    subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", INSTALL_PS1, *args],
        check=True,
    )


def send(launcher, manifest_path, message, env):
    payload = json.dumps(message).encode()
    # Firefox starts the launcher with the manifest path and extension ID.
    proc = subprocess.run(
        [launcher, manifest_path, EXTENSION_ID],
        input=struct.pack("=I", len(payload)) + payload,
        capture_output=True,
        env=env,
        timeout=60,
    )
    assert len(proc.stdout) >= 4, "no reply; stderr: {!r}".format(proc.stderr)
    (length,) = struct.unpack("=I", proc.stdout[:4])
    reply = json.loads(proc.stdout[4 : 4 + length])
    assert len(proc.stdout) == 4 + length, "extra output on stdout: {!r}".format(proc.stdout[4 + length :])
    return reply


def main():
    powershell()

    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, REGISTRY_KEY) as key:
        manifest_path = winreg.QueryValue(key, None)
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    assert manifest["name"] == "autohide_tab_bar", manifest
    assert manifest["allowed_extensions"] == [EXTENSION_ID], manifest
    launcher = manifest["path"]
    assert launcher.endswith(".bat") and os.path.isfile(launcher), launcher

    with tempfile.TemporaryDirectory() as appdata:
        root = os.path.join(appdata, "Mozilla", "Firefox")
        profile = os.path.join(root, "Profiles", "abc.default-release")
        os.makedirs(profile)
        with open(os.path.join(profile, "prefs.js"), "w") as f:
            f.write("// prefs\n")
        with open(os.path.join(root, "profiles.ini"), "w") as f:
            f.write("[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/abc.default-release\n\n"
                    "[InstallABC]\nDefault=Profiles/abc.default-release\n")
        env = dict(os.environ, APPDATA=appdata)

        with FirefoxStyleLock(os.path.join(profile, "parent.lock")):
            status = send(launcher, manifest_path, {"cmd": "status"}, env)
            assert status["ok"], status
            assert status["platform"] == "Windows", status
            assert status["profile"]["chosenBy"] == "running", status
            assert status["profile"]["path"] == os.path.realpath(profile), status

            applied = send(launcher, manifest_path, {
                "cmd": "apply",
                "css": "#TabsToolbar { color: red !important; }\n",
                "prefs": {"toolkit.legacyUserProfileCustomizations.stylesheets": True},
                "hash": "abcdef12",
            }, env)
            assert applied["ok"] and applied["installed"]["cssFile"] and applied["restartPending"], applied
            assert os.path.isfile(os.path.join(profile, "chrome", "autohide-tab-bar.css"))
            assert os.path.isfile(os.path.join(profile, "user.js"))

            removed = send(launcher, manifest_path, {"cmd": "remove"}, env)
            assert removed["ok"] and not removed["installed"]["cssFile"], removed

    powershell("-Uninstall")
    try:
        winreg.OpenKey(winreg.HKEY_CURRENT_USER, REGISTRY_KEY).Close()
        raise AssertionError("registry key still present after -Uninstall")
    except FileNotFoundError:
        pass
    assert not os.path.exists(launcher), launcher
    print("Windows helper check passed")


if __name__ == "__main__":
    main()
