#!/usr/bin/env bash
# Removes the Auto-Hide Tab Bar helper.
#
# This does not touch Firefox profiles. To take the tab bar styling out of
# Firefox, use "Remove from Firefox" in the extension's settings first.
set -euo pipefail

NAME="autohide_tab_bar"

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
    echo "Unsupported platform: $(uname -s)" >&2
    exit 1
    ;;
esac

rm -f "$MANIFEST_DIR/$NAME.json"
rm -f "$INSTALL_DIR/$NAME" "$INSTALL_DIR/autohide_tab_bar_host.py"
rmdir "$INSTALL_DIR" 2>/dev/null || true

echo "Removed the Auto-Hide Tab Bar helper."
