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

## Run

### macOS app

```sh
sh scripts/package-macos.sh
```

Open `dists/desktop/Rowset Community.app`. It lives in the menu bar, starts the
local server, creates its private configuration on first launch and signs you in
with a one-use local ticket. **Open Rowset** reopens the browser tab; **Quit**
asks to roll back open transactions. This local build is ad-hoc signed, not
notarized.

### Single executable (macOS, Windows, Linux)

```sh
sh scripts/build-local-binary.sh                        # this computer
GOOS=windows GOARCH=amd64 sh scripts/build-local-binary.sh   # Windows, rowset.exe
```

Then run `dists/local/rowset` (`rowset.exe` on Windows):

| Command | Effect |
| --- | --- |
| `rowset` or `rowset desktop` | start Rowset Studio, or open the running one |
| `rowset desktop-stop` | stop the running Rowset Studio |
| `rowset --version` | print the version |

Data lives in `Rowset/Community` under the user configuration directory
(`~/Library/Application Support` on macOS, `%AppData%` on Windows,
`~/.config` on Linux). Set `ROWSET_DESKTOP_DIR` to use another directory, for
example a disposable test workspace. The directory holds the encryption keys; do
not share it. Exported workspace JSON is **not** encrypted.

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
