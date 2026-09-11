# Rowset Studio

Rowset Studio is a SQL workspace for PostgreSQL, MySQL, MariaDB and SQL Server
that runs on your own computer. One executable serves the Studio web interface
on the loopback address and opens it in your browser; there is nothing else to
install or run.

## Features

- **Connections** — PostgreSQL, MySQL, MariaDB and SQL Server. Paste a
  connection URL or fill in the form. TLS modes `disable`, `require`,
  `verify-ca` and `verify-full`, custom CA and client certificates. Several
  nodes per connection with primary/secondary detection and routing.
- **SQL editor** — run the statement at the cursor, the selection, or every
  statement in the tab (each keeps its own result). Auto-commit or manual commit
  mode with explicit Commit/Rollback, cancellation, formatting, open/download
  `.sql` files.
- **Schema browser** — schemas, tables, views, routines, triggers, columns and
  indexes, with quick actions to open a table or copy names.
- **Notebooks** — Markdown notes and SQL cells together, encrypted and saved
  automatically. Export as Markdown or as a SQL script. **Save** in the editor
  adds the current query to a notebook; a cell opens in a new editor tab.
- **Activity** — your statements across every connection, plus per-connection
  history in the editor.
- **Policies** — default guardrails (block `DELETE`/`UPDATE` without `WHERE`,
  `DROP`, `TRUNCATE`, table reads without `WHERE`) and your own rules: block a
  table, schema or statement type, limit rows, stop long queries, allow writes
  only in a time window.
- **Workspace autosave** — tabs survive restarts; concurrent edits from another
  window are detected instead of overwritten. Tabs can be exported and imported.

Credentials, notebooks and workspaces are encrypted in a local SQLite database.

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

**Quit Rowset** at the bottom of the sidebar stops the server. On macOS the
menu-bar icon also offers **Open Rowset** and **Quit**; quitting asks to roll
back open transactions.

Data lives in `Rowset/Community` under the user configuration directory
(`~/Library/Application Support` on macOS, `%AppData%` on Windows,
`~/.config` on Linux). Set `ROWSET_DESKTOP_DIR` to use another directory, for
example a disposable test workspace. The directory holds the encryption keys; do
not share it. Exported workspace JSON is **not** encrypted.

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

Live engine tests run against real PostgreSQL, MySQL and SQL Server servers and
are skipped unless `ROWSET_MATRIX_POSTGRES_PASSWORD`,
`ROWSET_MATRIX_MYSQL_PASSWORD` and `ROWSET_MATRIX_MSSQL_PASSWORD` are set.

The version lives in `rowset-studio/package.json`; the build scripts stamp it
into Studio, the executable and the macOS app. See [CHANGELOG.md](CHANGELOG.md).
