#!/bin/sh
# Installs (or with --uninstall, removes) the Kits Firefox Editor helper for
# the current user, on macOS or Linux.
#
#   curl -fsSL https://github.com/mattsaund/kits-firefox-plugin/releases/latest/download/install.sh | sh
#   curl -fsSL https://github.com/mattsaund/kits-firefox-plugin/releases/latest/download/install.sh | sh -s -- --uninstall
#
# Run from a checkout it installs the helper next to it; piped from curl it
# downloads the helper from the latest release. Either way the helper is
# copied to its own folder and registered with Firefox as a native messaging
# host. Firefox profiles aren't touched here; the extension does that when you
# press Apply.
set -eu

NAME="autohide_tab_bar"
EXTENSION_ID="autohide-tab-bar@kits"
HOST_FILE="autohide_tab_bar_host.py"
DOWNLOAD="https://github.com/mattsaund/kits-firefox-plugin/releases/latest/download"

case "$(uname -s)" in
  Darwin)
    INSTALL_DIR="$HOME/Library/Application Support/AutoHideTabBar"
    MANIFEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
    ;;
  Linux)
    INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/autohide-tab-bar"
    MANIFEST_DIR="$HOME/.mozilla/native-messaging-hosts"
    ;;
  *)
    echo "Unsupported platform: $(uname -s). On Windows, use install.ps1 (see the README)." >&2
    exit 1
    ;;
esac

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$MANIFEST_DIR/$NAME.json" "$INSTALL_DIR/$NAME" "$INSTALL_DIR/$HOST_FILE"
  rmdir "$INSTALL_DIR" 2>/dev/null || true
  echo "Removed the Kits Firefox Editor helper."
  echo "To take the styling out of Firefox, use \"Remove from Firefox\" in the extension first."
  exit 0
fi

# Firefox starts the helper with a minimal PATH, so pin an absolute
# interpreter path now rather than relying on `env python3` later.
PYTHON=""
for candidate in "$(command -v python3 || true)" /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [ -n "$candidate" ] && [ -x "$candidate" ] &&
     "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' 2>/dev/null; then
    PYTHON="$candidate"
    break
  fi
done
if [ -z "$PYTHON" ]; then
  echo "Python 3.8 or newer is required but was not found." >&2
  [ "$(uname -s)" = Darwin ] && echo "Install it with: xcode-select --install   (or: brew install python)" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$MANIFEST_DIR"

# Run as a file from a checkout: use the helper beside it. Piped into sh, $0
# is the shell itself, so download the helper from the latest release.
case "$0" in
  */install.sh) SOURCE="$(cd "$(dirname "$0")" && pwd)/$HOST_FILE" ;;
  *) SOURCE="" ;;
esac
if [ -n "$SOURCE" ] && [ -f "$SOURCE" ]; then
  cp "$SOURCE" "$INSTALL_DIR/$HOST_FILE"
else
  curl -fsSL "$DOWNLOAD/$HOST_FILE" -o "$INSTALL_DIR/$HOST_FILE.download"
  mv "$INSTALL_DIR/$HOST_FILE.download" "$INSTALL_DIR/$HOST_FILE"
fi

LAUNCHER="$INSTALL_DIR/$NAME"
cat > "$LAUNCHER" <<EOF
#!/bin/sh
exec "$PYTHON" "$INSTALL_DIR/$HOST_FILE" "\$@"
EOF
chmod 755 "$LAUNCHER"

"$PYTHON" - "$MANIFEST_DIR/$NAME.json" "$LAUNCHER" "$EXTENSION_ID" <<'EOF'
import json, sys
out, path, ext_id = sys.argv[1:]
with open(out, "w") as f:
    json.dump({
        "name": "autohide_tab_bar",
        "description": "Kits Firefox Editor helper: installs the extension's userChrome stylesheet",
        "path": path,
        "type": "stdio",
        "allowed_extensions": [ext_id],
    }, f, indent=2)
    f.write("\n")
EOF

VERSION="$("$PYTHON" -c "import re,sys; print(re.search(r'^VERSION = \"(.+)\"', open(sys.argv[1]).read(), re.M).group(1))" "$INSTALL_DIR/$HOST_FILE")"
echo "Installed the Kits Firefox Editor helper $VERSION."
echo "Reopen the extension's settings page and it will connect."
