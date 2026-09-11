#!/bin/sh
# Build the release assets of Rowset Studio for every supported platform.
# Usage: scripts/release-build.sh VERSION OUTPUT_DIR
#
# Asset names carry no version, so
# https://github.com/dbaopsio/rowset-studio/releases/latest/download/<asset>
# always resolves to the newest release (install.sh and install.ps1 use it).
# The macOS app needs a macOS host (swiftc, lipo, codesign); elsewhere it is
# skipped. ROWSET_SIGN_IDENTITY signs the app with a Developer ID.
set -eu

[ "$#" -eq 2 ] || { printf '%s\n' 'Usage: release-build.sh VERSION OUTPUT_DIR' >&2; exit 2; }
VERSION=$1
case "$VERSION" in ''|*[!0-9A-Za-z._-]*) printf '%s\n' 'Invalid version.' >&2; exit 2 ;; esac
ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
mkdir -p "$2"
OUT=$(CDPATH= cd -- "$2" && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/rowset-release.XXXXXX")
trap 'rm -rf -- "$WORK"' EXIT HUP INT TERM

# Studio is built once and embedded into a private copy of the Go module, so
# the source tree's embedded placeholder stays untouched.
(
  cd "$ROOT_DIR/rowset-studio"
  VITE_ROWSET_VERSION="$VERSION" npm run build
)
mkdir -p "$WORK/src/rowset-core"
cp "$ROOT_DIR/rowset-core/go.mod" "$ROOT_DIR/rowset-core/go.sum" "$WORK/src/rowset-core/"
cp -R "$ROOT_DIR/rowset-core/cmd" "$ROOT_DIR/rowset-core/internal" "$WORK/src/rowset-core/"
cp -R "$ROOT_DIR/rowset-parser" "$WORK/src/rowset-parser"
rm -rf "$WORK/src/rowset-core/internal/web/dist"
cp -R "$ROOT_DIR/rowset-studio/dist" "$WORK/src/rowset-core/internal/web/dist"

for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64; do
  os=${target%/*}
  arch=${target#*/}
  name="rowset-studio-$os-$arch"
  dir="$WORK/pkg/$name"
  exe=rowset
  [ "$os" = windows ] && exe=rowset.exe
  mkdir -p "$dir"
  (
    cd "$WORK/src/rowset-core"
    CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -ldflags="-s -w -X main.version=$VERSION" -o "$dir/$exe" ./cmd/rowset
  )
  cp "$ROOT_DIR/README.md" "$ROOT_DIR/CHANGELOG.md" "$dir/"
  [ -f "$ROOT_DIR/LICENSE" ] && cp "$ROOT_DIR/LICENSE" "$dir/"
  [ "$os" = linux ] && cp "$ROOT_DIR/rowset-studio/public/favicon.svg" "$dir/rowset-studio.svg"
  if [ "$os" = windows ]; then
    (cd "$WORK/pkg" && zip -qr "$OUT/$name.zip" "$name")
  else
    tar -C "$WORK/pkg" -czf "$OUT/$name.tar.gz" "$name"
  fi
done

# One universal macOS app for Apple silicon and Intel.
if [ "$(uname -s)" = Darwin ]; then
  APP="$WORK/app/Rowset Studio.app"
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  lipo -create "$WORK/pkg/rowset-studio-darwin-amd64/rowset" "$WORK/pkg/rowset-studio-darwin-arm64/rowset" -output "$APP/Contents/Resources/rowset"
  cp "$ROOT_DIR/deploy/desktop/Info.plist" "$APP/Contents/Info.plist"
  plutil -replace CFBundleShortVersionString -string "$VERSION" "$APP/Contents/Info.plist"
  for arch in arm64 x86_64; do
    swiftc -target "$arch-apple-macos12" -module-cache-path "$WORK/swift-cache" "$ROOT_DIR/deploy/desktop/macos.swift" -o "$WORK/Rowset-$arch" -framework Cocoa
  done
  lipo -create "$WORK/Rowset-arm64" "$WORK/Rowset-x86_64" -output "$APP/Contents/MacOS/Rowset"
  if [ -n "${ROWSET_SIGN_IDENTITY:-}" ]; then
    codesign --force --options runtime --timestamp --sign "$ROWSET_SIGN_IDENTITY" "$APP/Contents/Resources/rowset"
    codesign --force --options runtime --timestamp --sign "$ROWSET_SIGN_IDENTITY" "$APP"
  else
    codesign --force --deep --sign - "$APP"
  fi
  (cd "$WORK/app" && ditto -c -k --keepParent "Rowset Studio.app" "$OUT/rowset-studio-macos.zip")
else
  printf '%s\n' 'Skipping the macOS app: it needs a macOS host.'
fi

cp "$ROOT_DIR/install.sh" "$ROOT_DIR/install.ps1" "$OUT/"
(
  cd "$OUT"
  rm -f SHA256SUMS
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum rowset-studio-* install.sh install.ps1 > SHA256SUMS
  else
    shasum -a 256 rowset-studio-* install.sh install.ps1 > SHA256SUMS
  fi
)
printf 'Release assets for %s in %s\n' "$VERSION" "$OUT"
