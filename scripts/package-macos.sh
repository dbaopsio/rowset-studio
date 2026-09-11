#!/bin/sh
set -eu
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
sh "$ROOT_DIR/scripts/build-local-binary.sh"
APP="$ROOT_DIR/dists/desktop/Rowset Studio.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$ROOT_DIR/dists/local/rowset" "$APP/Contents/Resources/rowset"
cp "$ROOT_DIR/deploy/desktop/Info.plist" "$APP/Contents/Info.plist"
VERSION=${ROWSET_VERSION:-$(node -p "require('$ROOT_DIR/rowset-studio/package.json').version")}
plutil -replace CFBundleShortVersionString -string "$VERSION" "$APP/Contents/Info.plist"
swiftc -module-cache-path "${TMPDIR:-/tmp}/rowset-swift-cache" "$ROOT_DIR/deploy/desktop/macos.swift" -o "$APP/Contents/MacOS/Rowset" -framework Cocoa
if [ -n "${ROWSET_SIGN_IDENTITY:-}" ]; then
  codesign --force --options runtime --timestamp --sign "$ROWSET_SIGN_IDENTITY" "$APP/Contents/Resources/rowset"
  codesign --force --options runtime --timestamp --sign "$ROWSET_SIGN_IDENTITY" "$APP"
else
  codesign --force --deep --sign - "$APP"
fi
printf 'Built %s\n' "$APP"
printf '%s\n' 'Public distribution requires Developer ID signing and notarization; this local build is not notarized.'
