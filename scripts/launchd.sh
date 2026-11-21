#!/bin/bash
# Keeps the Loom server running after login (macOS only).
#   scripts/launchd.sh install     write the LaunchAgent and start it
#   scripts/launchd.sh uninstall   stop it and remove the LaunchAgent
set -euo pipefail

LABEL="local.dashboard"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DASH_DATA_DIR:-$APP_DIR/data}"
PORT="${PORT:-4400}"
DOMAIN="gui/$(id -u)"

xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

case "${1:-}" in
  install)
    [[ "$(uname)" == "Darwin" ]] || { echo "launchd is macOS only." >&2; exit 1; }
    BUN="$(command -v bun)" || { echo "bun is not on PATH. Install it from https://bun.sh first." >&2; exit 1; }
    command -v git >/dev/null || { echo "git is not on PATH." >&2; exit 1; }
    command -v claude >/dev/null || { echo "The claude CLI is not on PATH. Install Claude Code and sign in first." >&2; exit 1; }
    mkdir -p "$DATA_DIR" "$(dirname "$PLIST")"
    # The service inherits this shell's PATH and HOME, so it finds the same bun, git and claude.
    cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$BUN")</string>
    <string>server/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$(xml "$APP_DIR")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(xml "$PATH")</string>
    <key>HOME</key><string>$(xml "$HOME")</string>
    <key>NODE_ENV</key><string>production</string>
    <key>PORT</key><string>$PORT</string>
    <key>DASH_DATA_DIR</key><string>$(xml "$DATA_DIR")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$(xml "$DATA_DIR/server.log")</string>
  <key>StandardErrorPath</key><string>$(xml "$DATA_DIR/server.log")</string>
</dict>
</plist>
PLIST
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Installed $PLIST"
    echo "Loom: http://127.0.0.1:$PORT   log: $DATA_DIR/server.log"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed $PLIST. Your data in $DATA_DIR is untouched."
    ;;
  *)
    echo "usage: $0 install|uninstall" >&2
    exit 2
    ;;
esac
