# Changelog

The version lives in `rowset-studio/package.json`. `scripts/build-local-binary.sh`
and `scripts/package-macos.sh` stamp it into Studio (sidebar), the `rowset`
executable and the macOS app. Every change set bumps the patch version and adds
an entry here.

## 0.0.56 — 2026-09-12

- **Run on several connections** (editor ⋯ menu) runs the selection, or the
  whole editor, on the connections you pick, each in its own database. Up to
  four run at a time; on each one the statements run in order in auto-commit
  and stop at the first error without stopping the others. Every statement
  goes through the normal query endpoint, so policies, row backups and history
  apply to each connection as usual.
- A script that changes data or schema asks for confirmation first and names
  the production connections among the targets; changing the choice asks
  again. Anything not recognisably a read counts as a change — procedure
  calls, SET, EXPLAIN ANALYZE, SELECT … INTO, a CTE ending in DELETE.
- The Connections tab lists every connection with its status, statements,
  rows and time next to the result of the one picked, showing a failure first.
  Results whose columns match can be combined into one grid with the
  connection in the first column. Stop all cancels every running statement.

## 0.0.55 — 2026-09-12

- Statements are recorded by one background writer in batches instead of two
  writes on every request. With 48 concurrent writers the local store went from
  613 to about 46,000 records a second. A record is never dropped: when the
  queue is full a request waits for room rather than competing with the writer
  for SQLite's lock, and history still shows a statement as soon as it has run.
- The audit chain reads its newest entry through an index. At 200,000 audit
  entries that read took 40 ms on every statement, behind a lock; it now takes
  0.01 ms.
- History is listed through its index instead of sorting every statement a
  person ever ran (20 ms at 200,000 rows).
- Retention periods are applied once a day on a shared server. A personal
  workspace keeps its history and audit log unless a period is set explicitly.
  Old entries are removed in small batches, so statements keep being recorded
  meanwhile, and the cutoff is compared in the same format the entries use.
- Snapshots are taken at most once a day, after Rowset is already answering.
  Taking one on every start meant a few restarts in a day rotated out last
  week's copy, and a large database held up opening the app.
- Before a new version applies migrations to an existing database, Rowset
  copies it to `snapshots/before-<migration>-<time>.sqlite3` and does not
  upgrade when that copy cannot be written. The daily snapshot is taken after
  migrations, so it could never undo one that went wrong.
- A loaded schema is reused for 30 seconds and loaded once when the explorer,
  autocomplete, the diagram and the assistant ask at the same time. DDL, a
  script or a procedure run through Rowset, the end of a transaction, editing
  the connection and Refresh all read the catalog again straight away.

## 0.0.54 — 2026-09-12

- Rowset writes a snapshot of its own database into `snapshots/` beside it on
  every start and keeps the newest seven, so a bad migration or a mistake is
  recoverable. SQLite's VACUUM INTO takes the copy in one transaction, which
  keeps it consistent with the write-ahead log.
- Starting on a data directory with no database says so on the console, and
  names ROWSET_DESKTOP_DIR, instead of quietly coming up as a new installation
  with no connections in it.
- `scripts/restart-try.sh` rebuilds and restarts the local instance against its
  own data directory.

## 0.0.53 — 2026-09-12

- Columns of the tables in the statement are offered through their alias, and
  a column that several of those tables share is offered only that way, since
  the bare name would not resolve.
- A SELECT that aggregates without a GROUP BY offers one: the quick fix on the
  statement fills in the columns it has to group by.

## 0.0.52 — 2026-09-12

- Autocomplete follows the clause you are in: columns come first while
  selecting or filtering, tables after FROM and JOIN.
- After FROM, the joins your foreign keys allow are offered with the ON
  clause already written, using the alias already in the statement.

## 0.0.51 — 2026-09-12

- **Slack notifications**: paste an incoming webhook address in Account and
  Rowset posts when a scheduled query runs — every run or only failures —
  with how long it took, how many rows it wrote and the file it produced.
  A statement in the editor that takes longer than a threshold you set can
  report itself too. The rows are never sent, only what ran.
- Every group in the schema browser, tables included, starts collapsed;
  searching opens them so matches are never hidden.

## 0.0.50 — 2026-09-12

- The assistant moved from the bottom tabs to a panel beside the editor,
  opened with the Assistant button in the toolbar, so it can stay open while
  a statement runs and its results come in. Its state is remembered.
- Format has an icon of its own; the wand now means the assistant.

## 0.0.49 — 2026-09-12

- **AI assistant**, set up in Account: either your own Anthropic or OpenAI
  key, kept encrypted like a connection password, or the `claude` / `codex`
  command already signed in on this computer, in which case no key reaches
  Rowset at all.
- It can write a statement from the schema, explain the one in the editor,
  rewrite it to run faster using the indexes that exist, say which index
  would help, and explain a failed statement and correct it.
- Table and column names, their types and the indexes of the open database
  are sent as context, never table contents, and sharing the schema can be
  turned off.

## 0.0.48 — 2026-09-12

- SQL shown outside the editor is coloured by the editor's own tokenizer
  instead of a short keyword list, so every keyword, function, string and
  number reads exactly as it does while typing.

## 0.0.47 — 2026-09-12

- The Plan tab appears only once Explain has produced a plan, and goes away
  with the next run.

## 0.0.46 — 2026-09-12

- SQL shown outside the editor (an object's DDL, the statements to review
  before applying grid changes) uses the editor's own colours.

## 0.0.45 — 2026-09-12

- **Diagram**: a map of a database's tables and the foreign keys between
  them, with primary and foreign key columns marked. Open it from a
  database's ⋯ menu in the explorer; drag to move, scroll to zoom, filter by
  name, and click a table to pick out what it is related to.

## 0.0.44 — 2026-09-12

- **Add and delete rows in the result grid**, next to editing cells: Add row
  types a new row at the end, and clicking a row's number marks it for
  deletion. Review shows the INSERT, UPDATE and DELETE statements, coloured,
  before anything runs; they run through the editor, so policies, manual
  commit and row backups apply as to any statement.

## 0.0.43 — 2026-09-12

- The DDL of an object is shown with SQL colouring.

## 0.0.42 — 2026-09-12

- SQL Server table DDL writes PRIMARY KEY and UNIQUE instead of the
  catalog's PRIMARY_KEY_CONSTRAINT spelling.

## 0.0.41 — 2026-09-12

- **Show DDL** in the schema browser: the statement that creates a table,
  view, procedure, function, trigger or sequence. MySQL and MariaDB answer
  with their own SHOW CREATE text, SQL Server and PostgreSQL with their
  stored definitions, and CREATE TABLE is built from the catalog where the
  engine has no function for it (columns, defaults, identity, keys, checks,
  foreign keys and indexes).

## 0.0.40 — 2026-09-12

- Opening the SQL editor always collapses the navigation to icons, however
  it was left before. Expanding it there lasts for that visit; every other
  page keeps the width last chosen on such a page.

## 0.0.39 — 2026-09-12

- Fixed: the navigation kept its old width in the SQL editor. Every
  workspace already had an explicit expanded/collapsed setting saved, which
  overrode the new automatic mode; the setting now lives under its own name
  and starts as automatic.

## 0.0.38 — 2026-09-12

- The navigation shows only its icons in the SQL editor, where the explorer
  needs the width, and stays open on the other pages. Using the collapse
  button fixes your choice everywhere until you use it again.
- Shutdown Rowset is tinted red.

## 0.0.37 — 2026-09-12

- The row limit policy no longer describes itself as rewriting statements,
  because it does not: it reads the rows up to the limit and stops.
- Live tests run against a desktop instance put a policy's value back too,
  not only whether it was on, so a test run cannot leave a workspace with
  its own row limit.
- "Shutdown Rowset" stays on one line in the sidebar again.

## 0.0.36 — 2026-09-12

- The schema browser lists **sequences** (PostgreSQL, SQL Server, MariaDB)
  next to views, procedures, functions and triggers. All of these groups
  stay collapsed until you open them.
- Expanding a database reloads its schema, so objects created since the
  last look appear without pressing refresh.

## 0.0.35 — 2026-09-12

- The row limit no longer rewrites statements. Rowset runs the SQL exactly
  as written and stops reading once the cap is reached, then cancels the
  rest, so no statement can be made invalid by a LIMIT or TOP that the user
  did not write. Exports and scheduled files follow the same rule, and an
  export that stops at the cap says so.

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
