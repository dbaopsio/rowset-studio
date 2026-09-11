#!/bin/sh
# Install or update Rowset Studio for the current user (macOS and Linux).
#
#   curl -fsSL https://raw.githubusercontent.com/dbaopsio/rowset-studio/main/install.sh | sh
#
# Environment:
#   ROWSET_VERSION      release to install, e.g. 0.0.13 (default: the latest)
#   ROWSET_INSTALL_DIR  directory for the rowset command (default: ~/.local/bin)
#
# Uninstall (your connections and notebooks are kept):
#   curl -fsSL https://raw.githubusercontent.com/dbaopsio/rowset-studio/main/install.sh | sh -s -- --uninstall
set -eu

REPO=dbaopsio/rowset-studio
BIN_DIR=${ROWSET_INSTALL_DIR:-"$HOME/.local/bin"}
APP="$HOME/Applications/Rowset Studio.app"
SHARE=${XDG_DATA_HOME:-"$HOME/.local/share"}
DESKTOP_ENTRY="$SHARE/applications/rowset-studio.desktop"
ICON="$SHARE/icons/hicolor/scalable/apps/rowset-studio.svg"

say() { printf '%s\n' "$*"; }
fail() { printf 'Rowset Studio install: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) fail "unsupported system $(uname -s). On Windows run install.ps1 in PowerShell." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported processor $(uname -m)" ;;
esac

stop_running() {
  if [ -x "$BIN_DIR/rowset" ]; then
    "$BIN_DIR/rowset" desktop-stop >/dev/null 2>&1 || true
  fi
}

if [ "${1:-}" = "--uninstall" ]; then
  stop_running
  rm -f "$BIN_DIR/rowset" "$DESKTOP_ENTRY" "$ICON"
  [ "$os" = darwin ] && rm -rf "$APP"
  say "Rowset Studio removed. Your data directory was kept:"
  if [ "$os" = darwin ]; then say "  ~/Library/Application Support/Rowset"; else say "  ${XDG_CONFIG_HOME:-~/.config}/Rowset"; fi
  exit 0
fi

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    fail "curl or wget is required"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

if [ -n "${ROWSET_VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/v${ROWSET_VERSION#v}"
else
  base="https://github.com/$REPO/releases/latest/download"
fi
base=${ROWSET_DOWNLOAD_BASE:-$base}

asset="rowset-studio-$os-$arch.tar.gz"
[ "$os" = darwin ] && asset="rowset-studio-macos.zip"

tmp=$(mktemp -d "${TMPDIR:-/tmp}/rowset-install.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT HUP INT TERM

say "Downloading $asset..."
fetch "$base/$asset" "$tmp/$asset" || fail "download failed: $base/$asset"
fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS" || fail "download failed: $base/SHA256SUMS"
expected=$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1 }' "$tmp/SHA256SUMS")
[ -n "$expected" ] || fail "no checksum for $asset"
[ "$(sha256 "$tmp/$asset")" = "$expected" ] || fail "checksum mismatch for $asset"

stop_running
mkdir -p "$BIN_DIR"
if [ "$os" = darwin ]; then
  ditto -x -k "$tmp/$asset" "$tmp/app"
  mkdir -p "$(dirname "$APP")"
  rm -rf "$APP"
  mv "$tmp/app/Rowset Studio.app" "$APP"
  xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
  ln -sf "$APP/Contents/Resources/rowset" "$BIN_DIR/rowset"
else
  tar -xzf "$tmp/$asset" -C "$tmp"
  dir="$tmp/rowset-studio-$os-$arch"
  cp "$dir/rowset" "$BIN_DIR/rowset.new"
  chmod 755 "$BIN_DIR/rowset.new"
  mv -f "$BIN_DIR/rowset.new" "$BIN_DIR/rowset"
  mkdir -p "$(dirname "$DESKTOP_ENTRY")" "$(dirname "$ICON")"
  cp "$dir/rowset-studio.svg" "$ICON"
  cat > "$DESKTOP_ENTRY" <<EOF
[Desktop Entry]
Type=Application
Name=Rowset Studio
Comment=SQL workspace for PostgreSQL, MySQL, MariaDB and SQL Server
Exec="$BIN_DIR/rowset" desktop
Icon=rowset-studio
Terminal=false
Categories=Development;Database;
EOF
fi

say "Installed $("$BIN_DIR/rowset" --version)."
if [ "$os" = darwin ]; then
  say "Open Rowset Studio from ~/Applications, or run: rowset"
else
  say "Open Rowset Studio from your applications menu, or run: rowset"
fi
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "Add $BIN_DIR to your PATH to use the rowset command, e.g. in ~/.profile:"
     say "  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
