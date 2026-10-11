#!/usr/bin/env bash
# Installs the Auto-Hide Tab Bar helper for the current user (macOS or Linux).
#
# Copies the helper out of this folder, so moving or deleting the project later
# doesn't break it, and registers it with Firefox as a native messaging host.
# Nothing is written to Firefox profiles here; the extension does that when you
# press Apply.
set -euo pipefail

NAME="autohide_tab_bar"
EXTENSION_ID="autohide-tab-bar@kits"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
    echo "Unsupported platform: $(uname -s). macOS and Linux only for now." >&2
    exit 1
    ;;
esac

# Firefox launches the helper with a minimal PATH, so pin an absolute
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
cp "$HERE/autohide_tab_bar_host.py" "$INSTALL_DIR/"

LAUNCHER="$INSTALL_DIR/$NAME"
cat > "$LAUNCHER" <<EOF
#!/bin/sh
exec "$PYTHON" "$INSTALL_DIR/autohide_tab_bar_host.py" "\$@"
EOF
chmod 755 "$LAUNCHER"

"$PYTHON" - "$MANIFEST_DIR/$NAME.json" "$LAUNCHER" "$EXTENSION_ID" <<'EOF'
import json, sys
out, path, ext_id = sys.argv[1:]
with open(out, "w") as f:
    json.dump({
        "name": "autohide_tab_bar",
        "description": "Auto-Hide Tab Bar helper: installs the extension's userChrome stylesheet",
        "path": path,
        "type": "stdio",
        "allowed_extensions": [ext_id],
    }, f, indent=2)
    f.write("\n")
EOF

echo "Installed the Auto-Hide Tab Bar helper."
echo "  helper:   $LAUNCHER"
echo "  python:   $PYTHON"
echo "  manifest: $MANIFEST_DIR/$NAME.json"
echo
echo "Reopen the extension's settings page and it will connect."
