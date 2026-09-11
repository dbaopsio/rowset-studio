# Changelog

The version lives in `rowset-studio/package.json`. `scripts/build-local-binary.sh`
and `scripts/package-macos.sh` stamp it into Studio (sidebar), the `rowset`
executable and the macOS app. Every change set bumps the patch version and adds
an entry here.

## 0.0.34 — 2026-09-12

- **Results are capped at 10,000 rows by default**, by the "Limit result
  rows" policy, which existing workspaces also get. It rewrites the
  statement (LIMIT, or TOP on SQL Server), says so under the result and
  offers Export all rows. Change the number or turn it off in My policies.
- That rewriting now handles more statements: SELECT DISTINCT and CTEs on
  SQL Server, MySQL's `LIMIT offset, count`, `FETCH FIRST n ROWS ONLY`, and
  statements ending in FOR UPDATE or LOCK IN SHARE MODE, which used to
  produce invalid SQL or an error.

## 0.0.33 — 2026-09-12

Performance of large results, now that nothing caps them:

- Streaming a result no longer copies every row already received on each
  progress update, which made a long result slower the longer it ran.
  Progress is reported less often as a result grows.
- Row batches are also flushed by size, so a table with large values cannot
  produce one enormous line for the browser to parse.
- Saving the editor's tabs waits longer between saves for large workspaces
  instead of encrypting everything on each keystroke.

## 0.0.32 — 2026-09-12

- The editor no longer caps results at 1000 rows. A result is capped only
  by the "Limit result rows" policy, which then says so and offers
  **Export all rows (CSV)**. Rows stream in as they arrive and the grid
  only renders what is on screen; Stop still ends a run.

## 0.0.31 — 2026-09-12

- **Procedures, functions, triggers and events with BEGIN … END bodies**
  (MySQL, MariaDB, SQL Server) were rejected as "multiple SQL statements",
  and the editor split them at their semicolons. Both now keep the body in
  one statement; END IF / END LOOP and BEGIN TRANSACTION are understood.
- A live test now creates and uses tables with keys, indexes, views,
  functions, procedures (CALL / EXEC), triggers and sequences on every
  engine, and checks the schema browser lists them.
- No hidden limits without a policy: exports, imports, plans, schema reads
  and restores are no longer cut off after 60 seconds; the editor's row cap
  says "Showing the first 1000 rows" with **Show up to 10,000** and
  **Export all rows (CSV)** instead of claiming a policy; a query that hits
  the connection's query timeout says so and where to change it (default
  10 minutes, up to 24 hours, per connection); personal workspaces accept
  32 MB requests, 16 MB of saved tabs and 20 manual-commit transactions.
- Errors reading policies, scheduled runs or a table's column types are
  reported instead of silently showing defaults.
- A divider separates the theme switch from Shutdown Rowset.

## 0.0.30 — 2026-09-12

- Long queries: a personal workspace no longer stops statements after 8–10
  minutes (a connection's own query timeout and policy timeouts still
  apply), a manual transaction is never rolled back as idle while one of
  its statements is running, idle transactions are kept for an hour
  instead of 5 minutes, and the desktop app keeps the computer from idle
  sleep while statements, exports, imports or restores run.
- The personal owner is no longer rate limited, which could make a busy
  editor fail with "too many requests".
- NaN and Infinity values (PostgreSQL float and numeric) no longer break
  the result; they show and restore as `NaN`, `Infinity` and `-Infinity`.
- Restoring SQL Server `sql_variant` values keeps each value's own type.
- The all-types test now covers far more types (PostgreSQL ranges,
  geometric types, tsvector, arrays, special numbers; MySQL/MariaDB text
  and blob sizes, bit(64), decimal(65,30), spatial types, inet4/inet6/uuid;
  SQL Server text/ntext/image, max types, time(7), sql_variant,
  hierarchyid, geography, geometry) and runs over the HTTP API. With
  ROWSET_E2E_DESKTOP_DIR it runs against a running desktop instance, so
  its work shows in that instance's Activity and Row backups.

## 0.0.29 — 2026-09-11

Every data feature was run against a table of all common column types on
PostgreSQL, MySQL, MariaDB and SQL Server (full, edge-value and NULL rows),
plus a 20,000-row table. Fixed what that found:

- Row backups: restoring skips generated and computed columns (and SQL
  Server rowversion), leaves identity columns out of UPDATEs, and inserts
  deleted rows with `OVERRIDING SYSTEM VALUE` on PostgreSQL identity tables.
- **Restore** in Activity → Row backups now puts rows back in one
  transaction, with policies applied; on SQL Server identity tables it turns
  IDENTITY_INSERT on for it. The script stays available as **Script**.
- Results show dates as `2024-02-29`, times as `13:45:10.123` and
  timestamps without the ISO `T…Z` form, so exports import back into MySQL
  and generated SQL works on every engine.
- SQL Server uniqueidentifier values show as GUIDs instead of hex, and
  binary columns always show as hex.
- CSV import writes hex (`\x…`) into binary columns as bytes, and editing
  a binary cell in the grid generates a hex literal.

## 0.0.28 — 2026-09-11

- The browser's Back button asks before leaving the SQL editor, even when
  nothing is running; links in the app ask only when a query runs or a
  transaction is open.

## 0.0.27 — 2026-09-11

- Autocomplete offers database names on MySQL, MariaDB and SQL Server, and
  on SQL Server suggests schemas after `database.`.
- Leaving the SQL editor while a query runs or a transaction is open asks
  first; a trackpad side swipe no longer navigates back out of the app.
- The row backup setting explains how the 10,000-row check works.

## 0.0.26 — 2026-09-11

- More compact Database Explorer; counts in square boxes.
- Tables show Open SELECT and Copy name on hover again; their ⋯ menu has
  **Export as CSV / JSON** and Import CSV.
- Table export downloads the whole table. It runs as a SELECT with the same
  policies, row limits and result hooks as the editor, so the default
  "no SELECT without WHERE" policy blocks it until turned off.
- Scheduled queries now honour policy row limits too.
- The result grid's column resize handle is invisible until hovered.

## 0.0.25 — 2026-09-11

- Redesigned Database Explorer: a search box for databases, tables and
  columns (⌘K / Ctrl K), + to add a connection, engine groups separated by
  lines, rounded count pills, and a ⋯ menu on connections (refresh, edit)
  and tables (open SELECT, copy name, import CSV).
- A line separates Shutdown Rowset from the version in the sidebar.

## 0.0.24 — 2026-09-11

- Redesigned the unsaved-tabs screen: each copy lists its tabs with
  Restore tabs, Download and Discard. Restored or discarded copies no longer
  come back on the next start, copies whose tabs were saved after all are
  cleared silently, and tabs already in the workspace are not added twice.

## 0.0.23 — 2026-09-11

- The row backup setting moved to Account (on by default).
- When a statement's rows cannot be backed up (more than 10,000 rows, or an
  UPDATE on a table without a primary key), it does not run; Rowset asks
  whether to run it without a backup.
- Fixed: tabs opened from a row backup made the tab autosave fail with
  "invalid JSON request".

## 0.0.22 — 2026-09-11

- Running a restore script no longer makes a new row backup of its own.
- The row backup option moved from the toolbar to the ⋯ menu
  (“Back up rows before UPDATE/DELETE”).
- Row backups list the statement without its leading comments, and MySQL
  tables no longer show the database name twice.

## 0.0.21 — 2026-09-11

- Row backups are optional: the **Row backup** switch in the editor toolbar
  turns them on or off (on by default, remembered in the browser).

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
