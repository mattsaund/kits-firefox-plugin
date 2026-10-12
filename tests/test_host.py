"""Tests for native-host/autohide_tab_bar_host.py. Run: python3 -m unittest discover -s tests"""

import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
HOST_PATH = os.path.join(HERE, "..", "native-host", "autohide_tab_bar_host.py")
sys.path.insert(0, os.path.dirname(HOST_PATH))
sys.path.insert(0, HERE)

import autohide_tab_bar_host as host  # noqa: E402

PREFS = {
    "toolkit.legacyUserProfileCustomizations.stylesheets": True,
    "sidebar.verticalTabs": True,
    "sidebar.position_start": False,
    "sidebar.visibility": "always-show",
}


def make_profile(root, name):
    path = os.path.join(root, "Profiles", name)
    os.makedirs(path)
    with open(os.path.join(path, "prefs.js"), "w") as f:
        f.write('user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", false);\n')
    return os.path.realpath(path)


def write_ini(root, *names, default=None):
    lines = []
    for i, name in enumerate(names):
        lines += ["[Profile{}]".format(i), "Name={}".format(name), "IsRelative=1", "Path=Profiles/{}".format(name), ""]
    if default:
        lines += ["[InstallABC]", "Default=Profiles/{}".format(default), "Locked=1", ""]
    with open(os.path.join(root, "profiles.ini"), "w") as f:
        f.write("\n".join(lines))


def read(path):
    with open(path) as f:
        return f.read()


class UserChromeOwnRules(unittest.TestCase):
    def test_own_rules_are_everything_but_our_block(self):
        original = "/* mine */\n.a { color: red; }\n"
        self.assertEqual(host.own_rules(host.IMPORT_BLOCK + original), original)
        self.assertEqual(host.own_rules(None), "")

    def test_merge_keeps_both_without_repeating(self):
        self.assertEqual(host.merge_rules(None, ".b{}\n"), ".b{}\n")
        self.assertEqual(host.merge_rules(".a{}\n", ".a{}\n"), ".a{}\n")
        self.assertEqual(host.merge_rules(".a{}\n", ".a{}\n.b{}\n"), ".a{}\n.b{}\n")
        self.assertEqual(host.merge_rules(".a{}\n.b{}\n", ".b{}\n"), ".a{}\n.b{}\n")
        self.assertEqual(host.merge_rules(".a{}", ".b{}\n"), ".a{}\n\n.b{}\n")
        self.assertEqual(host.merge_rules(".a{}\n", "  \n"), ".a{}\n")


class UserJs(unittest.TestCase):
    def test_block_is_last_and_replaced(self):
        existing = 'user_pref("sidebar.verticalTabs", false);\n'
        once = host.with_prefs(existing, PREFS)
        self.assertTrue(once.startswith(existing))
        self.assertTrue(once.rstrip().endswith(host.USERJS_END))
        self.assertIn('user_pref("sidebar.visibility", "always-show");', once)
        twice = host.with_prefs(once, {"sidebar.verticalTabs": False})
        self.assertEqual(twice.count(host.USERJS_BEGIN), 1)
        self.assertNotIn("sidebar.visibility", twice)

    def test_rejects_unlisted_or_mistyped_prefs(self):
        for bad in ({"security.sandbox.content.level": 0}, {"sidebar.verticalTabs": "yes"}, {"sidebar.visibility": "evil"}, {"browser.tabs.inTitlebar": 1}):
            with self.assertRaises(host.HostError):
                host.validate_prefs(bad)
        with self.assertRaises(host.HostError):
            host.validate_prefs({"sidebar.verticalTabs": 1})  # bool only, not int

    def test_address_bar_prefs(self):
        ok = {
            "browser.urlbar.trimURLs": False,
            "browser.urlbar.trimHttps": False,
            "browser.urlbar.suggest.searches": True,
            "browser.urlbar.openintab": True,
            "browser.urlbar.showSearchTerms.enabled": False,
            "browser.urlbar.maxRichResults": 20,
        }
        self.assertEqual(host.validate_prefs(ok), ok)
        self.assertIn('user_pref("browser.urlbar.maxRichResults", 20);', host.with_prefs("", ok))
        for bad in (0, 21, True, "10"):
            with self.assertRaises(host.HostError, msg=repr(bad)):
                host.validate_prefs({"browser.urlbar.maxRichResults": bad})

    def test_bookmarks_toolbar_pref(self):
        for value in ("always", "newtab", "never"):
            ok = {"browser.toolbars.bookmarks.visibility": value}
            self.assertEqual(host.validate_prefs(ok), ok)
        for bad in ("sometimes", True, 1):
            with self.assertRaises(host.HostError, msg=repr(bad)):
                host.validate_prefs({"browser.toolbars.bookmarks.visibility": bad})


class Profiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = self.tmp.name
        self.a = make_profile(self.root, "aaa.default")
        self.b = make_profile(self.root, "bbb.default-release")
        write_ini(self.root, "aaa.default", "bbb.default-release", default="bbb.default-release")

    def tearDown(self):
        self.tmp.cleanup()

    def test_install_default_listed_first(self):
        profiles = host.list_profiles(self.root)
        self.assertEqual([p["path"] for p in profiles], [self.b, self.a])
        self.assertTrue(profiles[0]["isDefault"])

    def test_choose_profile(self):
        profiles = host.list_profiles(self.root)
        self.assertEqual(host.choose_profile(None, profiles, None), (self.b, "guess"))
        self.assertEqual(host.choose_profile(None, profiles, {"path": self.a}), (self.a, "running"))
        self.assertEqual(host.choose_profile(self.a, profiles, None), (self.a, "requested"))
        with self.assertRaises(host.HostError):
            host.choose_profile("/etc", profiles, None)

    def test_apply_then_remove(self):
        ctx = {"profiles": host.list_profiles(self.root), "running": {"path": self.a, "pid": 1, "startedAt": 1.0}}
        chrome = os.path.join(self.a, "chrome")
        os.makedirs(chrome)
        with open(os.path.join(chrome, "userChrome.css"), "w") as f:
            f.write(".mine { color: red; }\n")
        with open(os.path.join(self.a, "user.js"), "w") as f:
            f.write('user_pref("browser.startup.page", 3);\n')

        res = host.handle({"cmd": "apply", "css": "#x { color: blue !important; }\n", "prefs": PREFS, "hash": "abcdef12"}, ctx)
        self.assertTrue(res["ok"])
        self.assertTrue(res["installed"]["cssFile"])
        self.assertEqual(res["installed"]["hash"], "abcdef12")
        self.assertTrue(res["restartPending"])  # applied after the (fake) start time
        self.assertTrue(res["profile"]["isRunning"])
        self.assertEqual(res["stylesheetsPref"], False)

        # The user's own rules are set aside, so they can't override ours.
        backup = os.path.join(chrome, "userChrome.css" + host.BACKUP_SUFFIX)
        self.assertEqual(read(os.path.join(chrome, "userChrome.css")), host.IMPORT_BLOCK)
        self.assertEqual(read(backup), ".mine { color: red; }\n")
        self.assertFalse(res["installed"]["otherRules"])
        self.assertIn("#x { color: blue", read(os.path.join(chrome, host.CSS_FILENAME)))
        self.assertIn('"sidebar.position_start", false', read(os.path.join(self.a, "user.js")))

        res = host.handle({"cmd": "remove"}, ctx)
        self.assertFalse(res["installed"]["cssFile"])
        self.assertFalse(res["installed"]["importLine"])
        self.assertFalse(res["installed"]["userJs"])
        self.assertTrue(res["ownRulesRestored"])
        self.assertEqual(read(os.path.join(chrome, "userChrome.css")), ".mine { color: red; }\n")
        self.assertFalse(os.path.exists(backup))
        self.assertEqual(read(os.path.join(self.a, "user.js")), 'user_pref("browser.startup.page", 3);\n')

    def test_rules_left_by_an_older_helper_are_set_aside_once(self):
        # Up to 0.3.2 the helper copied userChrome.css to the backup and kept
        # the rules in it below the import, where they overrode ours.
        ctx = {"profiles": host.list_profiles(self.root), "running": {"path": self.a, "pid": 1, "startedAt": 1.0}}
        chrome = os.path.join(self.a, "chrome")
        os.makedirs(chrome)
        old = "#sidebar-container { min-width: 10px !important; }\n"
        user_chrome = os.path.join(chrome, "userChrome.css")
        backup = user_chrome + host.BACKUP_SUFFIX
        with open(user_chrome, "w") as f:
            f.write(host.IMPORT_BLOCK + old)
        with open(backup, "w") as f:
            f.write(old)
        self.assertTrue(host.handle({"cmd": "status"}, ctx)["installed"]["otherRules"])

        host.handle({"cmd": "apply", "css": "#x{}", "prefs": PREFS}, ctx)
        self.assertEqual(read(user_chrome), host.IMPORT_BLOCK)
        self.assertEqual(read(backup), old)

        host.handle({"cmd": "remove"}, ctx)
        self.assertEqual(read(user_chrome), old)
        self.assertFalse(os.path.exists(backup))

    def test_rules_added_after_apply_are_kept_too(self):
        ctx = {"profiles": host.list_profiles(self.root), "running": {"path": self.a, "pid": 1, "startedAt": 1.0}}
        chrome = os.path.join(self.a, "chrome")
        os.makedirs(chrome)
        user_chrome = os.path.join(chrome, "userChrome.css")
        with open(user_chrome, "w") as f:
            f.write(".first {}\n")
        host.handle({"cmd": "apply", "css": "#x{}", "prefs": PREFS}, ctx)
        with open(user_chrome, "a") as f:
            f.write(".second {}\n")

        host.handle({"cmd": "apply", "css": "#x{}", "prefs": PREFS}, ctx)
        self.assertEqual(read(user_chrome), host.IMPORT_BLOCK)
        self.assertEqual(read(user_chrome + host.BACKUP_SUFFIX), ".first {}\n\n.second {}\n")

        with open(user_chrome, "a") as f:
            f.write(".third {}\n")
        self.assertTrue(host.handle({"cmd": "remove"}, ctx)["ownRulesRestored"])
        self.assertEqual(read(user_chrome), ".first {}\n\n.second {}\n\n.third {}\n")

    def test_remove_deletes_files_that_only_held_our_blocks(self):
        ctx = {"profiles": host.list_profiles(self.root), "running": None}
        host.handle({"cmd": "apply", "css": "#x{}", "prefs": PREFS, "profile": self.b}, ctx)
        res = host.handle({"cmd": "remove", "profile": self.b}, ctx)
        self.assertFalse(res["ownRulesRestored"])
        self.assertFalse(os.path.exists(os.path.join(self.b, "chrome", "userChrome.css")))
        self.assertFalse(os.path.exists(os.path.join(self.b, "user.js")))

    def test_never_writes_to_a_guessed_profile(self):
        ctx = {"profiles": host.list_profiles(self.root), "running": None}
        status = host.handle({"cmd": "status"}, ctx)
        self.assertEqual(status["profile"]["chosenBy"], "guess")
        for cmd in ("apply", "remove"):
            with self.assertRaises(host.HostError):
                host.handle({"cmd": cmd, "css": "#x{}", "prefs": PREFS}, ctx)
        self.assertFalse(os.path.exists(os.path.join(self.b, "chrome")))

    def test_running_profile_outside_profiles_ini_is_listed(self):
        elsewhere = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(elsewhere))
        running = {"path": os.path.realpath(elsewhere), "pid": 1, "startedAt": 1.0}
        status = host.handle({"cmd": "status"}, {"profiles": host.list_profiles(self.root), "running": running})
        self.assertEqual(status["profile"]["path"], running["path"])
        self.assertEqual(status["profiles"][0]["path"], running["path"])

    def test_titlebar_is_handed_back_when_the_bottom_toolbar_goes(self):
        ctx = {"profiles": host.list_profiles(self.root), "running": {"path": self.a, "pid": 1, "startedAt": 1.0}}
        bottom = dict(PREFS, **{"browser.tabs.inTitlebar": 0})
        host.handle({"cmd": "apply", "css": "#x{}", "prefs": bottom}, ctx)
        user_js = read(os.path.join(self.a, "user.js"))
        self.assertIn('user_pref("browser.tabs.inTitlebar", 0);', user_js)

        # Toolbar back on top: Firefox's default title bar comes back once.
        host.handle({"cmd": "apply", "css": "#x{}", "prefs": PREFS}, ctx)
        self.assertIn('user_pref("browser.tabs.inTitlebar", -1);', read(os.path.join(self.a, "user.js")))
        # ...and isn't pinned after that.
        host.handle({"cmd": "apply", "css": "#x{}", "prefs": PREFS}, ctx)
        self.assertNotIn("inTitlebar", read(os.path.join(self.a, "user.js")))

    def test_remove_reports_a_title_bar_left_on(self):
        ctx = {"profiles": host.list_profiles(self.root), "running": {"path": self.a, "pid": 1, "startedAt": 1.0}}
        host.handle({"cmd": "apply", "css": "#x{}", "prefs": dict(PREFS, **{"browser.tabs.inTitlebar": 0})}, ctx)
        self.assertTrue(host.handle({"cmd": "remove"}, ctx)["titlebarLeftOn"])
        host.handle({"cmd": "apply", "css": "#x{}", "prefs": PREFS}, ctx)
        host.handle({"cmd": "apply", "css": "#x{}", "prefs": PREFS}, ctx)
        self.assertFalse(host.handle({"cmd": "remove"}, ctx)["titlebarLeftOn"])

    def test_settle_drops_prefs_only_after_firefox_has_saved_them(self):
        import time as _time
        with open(os.path.join(self.a, "user.js"), "w") as f:
            f.write('user_pref("browser.startup.page", 3);\n')
        before = {"profiles": host.list_profiles(self.root), "running": {"path": self.a, "pid": 1, "startedAt": 1.0}}
        host.handle({"cmd": "apply", "css": "#x{}", "prefs": dict(PREFS, **{"browser.tabs.inTitlebar": 0})}, before)
        prefs_js = os.path.join(self.a, "prefs.js")

        # The Firefox that applied hasn't restarted: the prefs aren't loaded yet.
        self.assertFalse(host.handle({"cmd": "settle"}, before)["settled"])

        # Restarted, but prefs.js not rewritten since: not saved yet.
        started = _time.time() + 5
        after = {"profiles": host.list_profiles(self.root), "running": {"path": self.a, "pid": 1, "startedAt": started}}
        os.utime(prefs_js, (started - 1, started - 1))
        self.assertFalse(host.handle({"cmd": "settle"}, after)["settled"])

        # Saved: the block goes, the user's own user.js lines stay.
        os.utime(prefs_js, (started + 1, started + 1))
        self.assertTrue(host.handle({"cmd": "settle"}, after)["settled"])
        self.assertEqual(read(os.path.join(self.a, "user.js")), 'user_pref("browser.startup.page", 3);\n')
        self.assertFalse(host.handle({"cmd": "status"}, after)["installed"]["userJs"])

        # The title bar is still handed back after a settle, from the stylesheet's record.
        host.handle({"cmd": "apply", "css": "#x{}", "prefs": PREFS}, after)
        self.assertIn('user_pref("browser.tabs.inTitlebar", -1);', read(os.path.join(self.a, "user.js")))

    def test_settle_never_guesses_a_profile(self):
        ctx = {"profiles": host.list_profiles(self.root), "running": None}
        self.assertEqual(host.handle({"cmd": "settle"}, ctx), {"ok": True, "settled": False})

    def test_stylesheets_may_not_load_other_files(self):
        ctx = {"profiles": host.list_profiles(self.root), "running": {"path": self.a, "pid": 1, "startedAt": 1.0}}
        for css in ('#x { background: url("https://example.com/t.png"); }', '@import "evil.css";', "#x{background:URL (a)}"):
            with self.assertRaises(host.HostError, msg=css):
                host.handle({"cmd": "apply", "css": css, "prefs": PREFS}, ctx)

    def test_apply_rejects_bad_input(self):
        ctx = {"profiles": host.list_profiles(self.root), "running": None}
        for msg in (
            {"cmd": "apply", "css": "", "prefs": PREFS, "profile": self.b},
            {"cmd": "apply", "css": "#x{}", "prefs": {"app.update.auto": False}, "profile": self.b},
            {"cmd": "apply", "css": "#x{}", "prefs": PREFS, "hash": "../../etc", "profile": self.b},
            {"cmd": "apply", "css": "#x{}", "prefs": PREFS, "profile": self.root},
            {"cmd": "rm -rf"},
        ):
            with self.assertRaises(host.HostError, msg=str(msg)):
                host.handle(msg, ctx)


@unittest.skipUnless(sys.platform == "win32", "Windows only")
class WindowsProfileLock(unittest.TestCase):
    def setUp(self):
        from winlock import FirefoxStyleLock

        self.Lock = FirefoxStyleLock
        self.tmp = tempfile.TemporaryDirectory()
        self.a = make_profile(self.tmp.name, "aaa.default")
        self.b = make_profile(self.tmp.name, "bbb.default-release")
        write_ini(self.tmp.name, "aaa.default", "bbb.default-release", default="bbb.default-release")
        self.profiles = host.list_profiles(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_locked_profile_is_the_running_one(self):
        # A parent.lock nobody holds is what a Firefox that has quit leaves behind.
        open(os.path.join(self.a, "parent.lock"), "w").close()
        with self.Lock(os.path.join(self.b, "parent.lock")):
            running = host.running_firefox(self.profiles)
            self.assertEqual(running["path"], self.b)
            self.assertIsNotNone(running["startedAt"])
        self.assertIsNone(host.running_firefox(self.profiles))

    def test_two_running_profiles_are_left_to_the_user(self):
        with self.Lock(os.path.join(self.a, "parent.lock")), self.Lock(os.path.join(self.b, "parent.lock")):
            self.assertEqual(len(host.windows_running_profiles(self.profiles)), 2)
            self.assertIsNone(host.running_firefox(self.profiles))


class Protocol(unittest.TestCase):
    """Runs the script the way Firefox does: length-prefixed JSON over stdio."""

    def status_in(self, home, root):
        """The helper's status reply, with HOME at home and a profile in root."""
        os.makedirs(root)
        make_profile(root, "zzz.default-release")
        write_ini(root, "zzz.default-release", default="zzz.default-release")
        payload = json.dumps({"cmd": "status"}).encode()
        env = dict(os.environ, HOME=home, APPDATA=os.path.join(home, "AppData", "Roaming"))
        env.pop("XDG_CONFIG_HOME", None)
        proc = subprocess.run(
            [sys.executable, HOST_PATH],
            input=struct.pack("=I", len(payload)) + payload,
            capture_output=True,
            env=env,
            timeout=30,
        )
        (length,) = struct.unpack("=I", proc.stdout[:4])
        return json.loads(proc.stdout[4 : 4 + length])

    def test_status_round_trip(self):
        with tempfile.TemporaryDirectory() as home:
            if sys.platform == "darwin":
                root = os.path.join(home, "Library", "Application Support", "Firefox")
            elif sys.platform == "win32":
                root = os.path.join(home, "AppData", "Roaming", "Mozilla", "Firefox")
            else:
                root = os.path.join(home, ".mozilla", "firefox")
            reply = self.status_in(home, root)
            self.assertTrue(reply["ok"], reply)
            self.assertEqual(reply["profile"]["name"], "zzz.default-release")
            self.assertFalse(reply["installed"]["cssFile"])

    @unittest.skipUnless(sys.platform.startswith("linux"), "Linux only")
    def test_linux_profiles_under_xdg_config(self):
        with tempfile.TemporaryDirectory() as home:
            reply = self.status_in(home, os.path.join(home, ".config", "mozilla", "firefox"))
            self.assertTrue(reply["ok"], reply)
            self.assertEqual([p["name"] for p in reply["profiles"]], ["zzz.default-release"])

    def test_errors_are_reported_not_crashed(self):
        payload = b"not json"
        proc = subprocess.run(
            [sys.executable, HOST_PATH], input=struct.pack("=I", len(payload)) + payload, capture_output=True, timeout=30
        )
        (length,) = struct.unpack("=I", proc.stdout[:4])
        reply = json.loads(proc.stdout[4 : 4 + length])
        self.assertFalse(reply["ok"])


if __name__ == "__main__":
    unittest.main()
