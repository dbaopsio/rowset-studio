# Rowset Studio

Rowset Studio is a SQL workspace for PostgreSQL, MySQL, MariaDB and SQL Server
that runs on your own computer. Personal workspaces also support SQLite,
DuckDB (CGO builds), ClickHouse and a read-only MongoDB document explorer. One executable serves the Studio web interface
on the loopback address and opens it in your browser; there is nothing else to
install or run.

## Features

- **Connections** — PostgreSQL, MySQL, MariaDB and SQL Server. Paste a
  connection URL or fill in the form. TLS modes `disable`, `require`,
  `verify-ca` and `verify-full`, custom CA and client certificates. Several
  nodes per connection with primary/secondary detection and routing. Reach a
  database through an **SSH tunnel** (password or private key), with the
  server's host key trusted the first time and verified on every connection.
- **SQL editor** — run the statement at the cursor, the selection, or every
  statement in the tab (each keeps its own result). Auto-commit or manual commit
  mode with explicit Commit/Rollback, cancellation, formatting, open/download
  `.sql` files.
- **Execution plans** — Explain draws the plan of a statement as a diagram
  with cost heat and warnings; actual rows and timings on request.
- **Edit rows** — change cells of a one-table result, review the generated
  UPDATE statements and apply them like any query.
- **CSV import** — import a CSV file into a table in one transaction, with a
  preview and column mapping.
- **Schema browser** — schemas, tables, views, routines, triggers, columns and
  indexes, with quick actions to open a table or copy names.
- **Notebooks** — Markdown notes and SQL cells together, encrypted and saved
  automatically. Export as Markdown or as a SQL script. **Save** in the editor
  adds the current query to a notebook; a cell opens in a new editor tab.
- **Row backups** — optionally save the rows an UPDATE or DELETE changes;
  Activity → Row backups opens a script that puts them back.
- **Schedules** — run a SELECT at set times in your time zone and save each
  result as a CSV or JSON file, while Rowset Studio is running.
- **Activity** — your statements across every connection, plus per-connection
  history in the editor.
- **Policies** — default guardrails (block `DELETE`/`UPDATE` without `WHERE`,
  `DROP`, `TRUNCATE`, table reads without `WHERE`) and your own rules: block a
  table, schema or statement type, limit rows, stop long queries, allow writes
  only in a time window.
- **Workspace autosave** — tabs survive restarts; concurrent edits from another
  window are detected instead of overwritten. Tabs can be exported and imported.

Credentials, notebooks and workspaces are encrypted in a local SQLite database.

## Additional databases and schema comparison

**Schema comparison** is available in the sidebar and a database's menu.
Choose the desired source structure and the target database/schema. The page
compares table/column metadata and index summaries, and shows each table's DDL
side by side. A migration draft opens in the target SQL editor without running.
Only simple nullable column additions are generated; other changes remain
explicit manual steps. This is not a complete dependency-aware migration tool:
CHECK constraints, complete index/FK definitions, views and routines need
separate DDL review. Failed metadata reads are shown and disable drafts.

| Engine | Connection | Initial support |
| --- | --- | --- |
| SQLite | Absolute path to an existing file | SQL, transactions, schema, keys, indexes, DDL, CSV/JSON export |
| DuckDB | Absolute path to an existing file; CGO build | SQL, transactions, tables/views, DDL, CSV/JSON export |
| ClickHouse | Native TCP: 9440 with TLS, 9000 without | SQL, databases, tables/views, DDL, CSV/JSON export |
| MongoDB | Host/port; credentials use `authSource=admin` | Database/collection browser, find/filter/sort, cancellation, Extended JSON export |

The new engines are available in personal workspaces, with one configured
endpoint. MongoDB has its own **Documents** page and is read-only; aggregation,
SRV URLs and SSH are not yet supported. DuckDB/ClickHouse key and index metadata
is not yet loaded. Inline grid editing, CSV import and SQL INSERT export remain
available only for the original four engines. Query the SQL engines directly
for other supported operations.

Native `build-local-binary.sh` builds include DuckDB and require a working C/C++
compiler. `CGO_ENABLED=0` builds, including the portable cross-platform release
script, omit DuckDB; the UI only offers it when the server includes it.
Cross-compiling with DuckDB requires a C/C++ toolchain for the target platform.

## Install

**macOS and Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/dbaopsio/rowset-studio/main/install.sh | sh
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/dbaopsio/rowset-studio/main/install.ps1 | iex
```

The installer downloads the latest release, verifies its SHA-256 checksum and
installs for the current user only; no administrator rights are needed.

| System | Installed to |
| --- | --- |
| macOS | `~/Applications/Rowset Studio.app` (menu-bar app) and `~/.local/bin/rowset` |
| Linux | `~/.local/bin/rowset` and an applications-menu entry |
| Windows | `%LOCALAPPDATA%\Programs\Rowset Studio`, a Start menu entry and the user `PATH` |

Run the same command again to update. `ROWSET_VERSION=0.0.13` installs a
specific release. To uninstall, run `sh -s -- --uninstall` instead of `sh` on
macOS/Linux, or set `$env:ROWSET_UNINSTALL = 1` before the PowerShell command;
your connections and notebooks are kept.

Prefer to download yourself? Every [release](https://github.com/dbaopsio/rowset-studio/releases)
has archives for macOS (Apple silicon, Intel and a universal app), Windows and
Linux (x64 and ARM64) plus `SHA256SUMS`. Releases are not code-signed yet, so a
file downloaded with a browser triggers Gatekeeper or SmartScreen; on macOS,
`xattr -dr com.apple.quarantine "Rowset Studio.app"` clears it.

## Run

Open **Rowset Studio** from the applications menu, or run `rowset`. It starts
the local server, creates its private configuration on first launch, signs you
in with a one-use local ticket and opens your browser.

| Command | Effect |
| --- | --- |
| `rowset` or `rowset desktop` | start Rowset Studio, or open the running one |
| `rowset desktop-stop` | stop the running Rowset Studio |
| `rowset --version` | print the version |

**Shutdown Rowset** at the bottom of the sidebar stops the server. On macOS the
menu-bar icon also offers **Open Rowset** and **Quit**; quitting asks to roll
back open transactions.

Data lives in `Rowset/Community` under the user configuration directory
(`~/Library/Application Support` on macOS, `%AppData%` on Windows,
`~/.config` on Linux). Set `ROWSET_DESKTOP_DIR` to use another directory, for
example a disposable test workspace. The directory holds the encryption keys; do
not share it. Exported workspace JSON is **not** encrypted.

Rowset writes a copy of its database into `snapshots/` in the same directory
once a day and keeps the newest seven. Before a new version upgrades the
database it also writes a `before-…` copy, which is never rotated out. To go
back to a copy, quit Rowset and put the file in place of
`rowset-community.sqlite3`.

Statement history and the audit log are kept for as long as you keep them. To
remove old entries automatically, set a period in days:

| Variable | Removes |
| --- | --- |
| `ROWSET_QUERY_HISTORY_RETENTION_DAYS` | history entries older than this |
| `ROWSET_AUDIT_RETENTION_DAYS` | audit entries older than this |

A shared server applies 30 days of history and 90 days of audit unless these are
set; `0` keeps everything.

## Build from source

```sh
sh scripts/build-local-binary.sh                             # this computer
GOOS=windows GOARCH=amd64 sh scripts/build-local-binary.sh   # Windows, rowset.exe
sh scripts/package-macos.sh                                  # macOS menu-bar app
sh scripts/release-build.sh 0.0.13 release                   # every release asset
```

Pushing a `vX.Y.Z` tag that matches `rowset-studio/package.json` runs the
release workflow, which tests, builds and publishes the assets.

## Build requirements

- Go 1.25
- Node.js with npm (install Studio dependencies with `npm ci` in `rowset-studio`)
- For the macOS app: Xcode command-line tools (`swiftc`, `codesign`)

## Development

| Directory | Contents |
| --- | --- |
| `rowset-core` | Go server: API, database engines, local store |
| `rowset-parser` | SQL classification and rewriting used by policies |
| `rowset-studio` | React/TypeScript Studio (Vite, TanStack Query, Monaco) |
| `deploy/desktop` | macOS menu-bar wrapper |

```sh
(cd rowset-parser && go test ./...)
(cd rowset-core && go vet ./... && go test ./...)
(cd rowset-studio && npm run build && npm run lint && npm test)
```

Live engine tests run against real PostgreSQL, MySQL, MariaDB and SQL Server
servers and are skipped unless `ROWSET_MATRIX_POSTGRES_PASSWORD`,
`ROWSET_MATRIX_MYSQL_PASSWORD`, `ROWSET_MATRIX_MARIADB_PASSWORD` and
`ROWSET_MATRIX_MSSQL_PASSWORD` are set.

The version lives in `rowset-studio/package.json`; the build scripts stamp it
into Studio, the executable and the macOS app. See [CHANGELOG.md](CHANGELOG.md).

## License

Rowset Studio is licensed under the [Apache License 2.0](LICENSE).
