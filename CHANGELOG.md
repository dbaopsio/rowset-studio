# Changelog

The version lives in `rowset-studio/package.json`. `scripts/build-local-binary.sh`
and `scripts/package-macos.sh` stamp it into Studio (sidebar), the `rowset`
executable and the macOS app. Every change set bumps the patch version and adds
an entry here.

## 0.0.20 — 2026-09-11

- **Row backups**: before an UPDATE or DELETE on one table with a WHERE
  clause, Rowset saves the rows it is about to change (up to 10,000,
  encrypted, newest 100 kept). Activity → Row backups opens a restore script
  in a new editor tab: INSERTs for deleted rows, UPDATEs by primary key for
  changed ones. UPDATEs on tables without a primary key are not backed up,
  and the editor says why. A statement that fails keeps no backup.
- Fixed: `WHERE id <= 2` and `WHERE status != 'x'` were treated as always
  true, so the UPDATE/DELETE-without-WHERE policies blocked them.
- Redesigned CSV import dialog (drop zone, mapping table, progress) and a
  lighter schema tree: plain counts instead of boxed badges, compact rows,
  search with the refresh button inside.
- The light/dark switch sits next to Shutdown Rowset in the sidebar.

## 0.0.19 — 2026-09-11

- **Import CSV** from a table in the schema browser: preview, delimiter
  detection, header and empty-as-NULL options, column mapping. The file
  uploads in chunks and is inserted in one transaction, so either every row
  is imported or none is; policies apply as to any INSERT.
- Fixed: after switching tabs, Run and Explain could use the selection of
  the previous tab.
- A new run in a tab clears its old execution plan.
- The desktop sidebar no longer shows the account email and role, and
  Shutdown Rowset uses the normal text colour.

## 0.0.18 — 2026-09-11

- **Edit rows** in the result grid: when a result comes from one table and
  includes its primary key, double-click a cell to change it (or set NULL).
  Review shows the generated UPDATE statements; applying runs them through
  the editor (policies and manual commit apply) and reloads the result.
- Query results report which table column each result column comes from,
  also inside manual-commit transactions.

## 0.0.17 — 2026-09-11

- **Schedules** run a SELECT every day, on chosen weekdays or every few
  minutes, in a chosen time zone, and save each result as a new CSV or JSON
  file in a folder. They run while Rowset Studio is running, even with the
  browser closed; a run missed while it was closed either runs once when it
  opens or is skipped. Runs go through the same policies as the editor, are
  listed per schedule and appear in Activity. "Schedule this query" in the
  editor starts a schedule from the current statement. The SQL of a schedule
  is stored encrypted.

## 0.0.16 — 2026-09-11

- **Explain** draws the execution plan of the statement under the cursor in
  a new Plan tab: operators, row flow, cost heat, warnings and properties.
  PostgreSQL, MySQL, MariaDB and SQL Server show the estimated plan without
  running the statement; **Explain with actual rows** runs a SELECT to show
  actual rows and timings (PostgreSQL, MySQL, MariaDB). Policies apply to
  actual-row runs. The diagram comes from executionflow.

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
