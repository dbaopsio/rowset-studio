#!/bin/sh
# Rebuilds the local binary and restarts the try instance against its own data
# directory. Starting it without ROWSET_DESKTOP_DIR opens the default directory
# instead, which has no connections in it and looks like the data is gone.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dir=${ROWSET_DESKTOP_DIR:-$HOME/Documents/rowset-try}

if [ "${1:-}" != "--no-build" ]; then
	sh "$root/scripts/build-local-binary.sh"
fi

# Matched on the path fragment, so it catches the instance however it was
# started: "./dists/local/rowset desktop" as well as the absolute path.
pkill -f "dists/local/rowset desktop" 2>/dev/null || true
# Give the old process time to release the port and the instance lock.
sleep 3


# Its output goes to the log rather than to whatever called this script: a
# background process holding the console open keeps a pipeline from ever
# finishing.
ROWSET_DESKTOP_DIR="$dir" nohup "$root/dists/local/rowset" desktop >>"$dir/desktop.log" 2>&1 &
sleep 3

port=$(sed -n 's/.*"port":\([0-9]*\).*/\1/p' "$dir/instance.json" 2>/dev/null || true)
printf 'Rowset running on http://127.0.0.1:%s with data in %s\n' "${port:-unknown}" "$dir"
