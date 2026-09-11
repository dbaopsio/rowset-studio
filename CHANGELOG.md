# Changelog

The version lives in `rowset-studio/package.json`. `scripts/build-local-binary.sh`
and `scripts/package-macos.sh` stamp it into Studio (sidebar), the `rowset`
executable and the macOS app. Every change set bumps the patch version and adds
an entry here.

## 0.0.15 — 2026-09-11

- The desktop app has no password: it signs in through its launcher every
  time it opens. Sign out and the first-use password step are gone; an
  expired session shows how to open Rowset Studio again.
- Licensed under the Apache License 2.0; release archives include LICENSE.

## 0.0.14 — 2026-09-11

- First use asks the desktop owner to choose a password; signing in later
  needs only that password (no email).
- **Shutdown Rowset** sits at the bottom of the sidebar and confirms in the
  page instead of a browser dialog.
- Account page redesigned: profile, installation details and password change.

## 0.0.13 — 2026-09-11

- Releases: `scripts/release-build.sh` builds archives for macOS (arm64,
  amd64), Linux and Windows (amd64, arm64), a universal macOS app and
  `SHA256SUMS`; pushing a version tag publishes them through GitHub Actions.
- One-line installers for the current user: `install.sh` (macOS, Linux) and
  `install.ps1` (Windows), with checksum verification, update and uninstall.
- **Quit Rowset** in the sidebar stops the local server, rolling back open
  transactions after confirmation.
- The macOS app is named Rowset Studio.
- CI runs the Go and Studio tests on every push and pull request.

## 0.0.12 — 2026-09-11

First public snapshot of Rowset Studio.

- Local server with a one-use loopback sign-in; single executable for macOS,
  Windows and Linux, plus a macOS menu-bar app.
- Connections for PostgreSQL, MySQL, MariaDB and SQL Server with TLS modes
  (`disable`, `require`, `verify-ca`, `verify-full`), CA and client
  certificates, and multi-node topology with primary/secondary routing.
- SQL editor: run statement, selection or all statements with a result per
  statement, auto-commit or manual commit mode, cancellation, `.sql` open and
  download, workspace export and import.
- Transactions report whether they are active, aborted or lost; a lost
  transaction is cleaned up and reported instead of failing silently.
- Schema browser with table actions and compact search.
- Notebooks with Markdown notes and SQL cells, encrypted autosave, Markdown and
  SQL export; saved queries from earlier builds are imported once.
- Activity page with your statements across all connections.
- Default and custom policies enforced before a statement reaches the database.
- Workspace autosave with revision checks against concurrent windows.
