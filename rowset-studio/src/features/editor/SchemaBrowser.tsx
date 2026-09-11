import { useContext, useState } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { ApiError } from "../../lib/api";
import { useSchema } from "./useEditor";
import { ColumnInfo, RoutineInfo, TableInfo, TriggerInfo } from "./api";
import { SchemaActions, quoteIdentifier, tableSelect } from "./schemaActions";

// Shorten verbose SQL type names so long ones don't crowd out the column name.
function shortType(t: string) {
  const map: Record<string, string> = {
    "timestamp without time zone": "timestamp",
    "timestamp with time zone": "timestamptz",
    "time without time zone": "time",
    "character varying": "varchar",
    "double precision": "double",
    "character": "char",
  };
  return map[t.toLowerCase()] ?? t;
}

function colTitle(c: ColumnInfo) {
  const parts = [`${c.name} ${c.dataType}`, c.nullable ? "nullable" : "not null"];
  if (c.pk) parts.push("primary key");
  if (c.references) parts.push(`→ ${c.references}`);
  if (c.default) parts.push(`default: ${c.default}`);
  if (c.generated) parts.push(c.generated);
  if (c.comment) parts.push(c.comment);
  return parts.join(" · ");
}

function qualifyName(engine: string, schemaName: string, objectName: string) {
  if (engine === "mysql" || engine === "mariadb") return objectName;
  return schemaName && schemaName !== "default" ? `${schemaName}.${objectName}` : objectName;
}

type QualifiedTable = {
  key: string;
  schemaName: string;
  table: TableInfo;
};

type QualifiedRoutine = {
  key: string;
  schemaName: string;
  routine: RoutineInfo;
};

type QualifiedTrigger = {
  key: string;
  schemaName: string;
  trigger: TriggerInfo;
};

// Lazy schema tree rendered as a flat database object list. Schemas stay in the
// object names (`schema.table`) instead of taking their own tree level.
export default function SchemaBrowser({
  connectionId,
  database,
  engine = "",
  compact = false,
}: {
  connectionId: string | null;
  database?: string;
  engine?: string;
  compact?: boolean;
}) {
  const { data, isLoading, isError, error, refetch, isFetching } = useSchema(connectionId, database);
  const [filter, setFilter] = useState("");
  const [schemaFilter, setSchemaFilter] = useState("");

  if (!connectionId) return <Hint>Select a connection.</Hint>;
  if (isLoading) return <Hint>Loading schema…</Hint>;
  if (isError) return (
    <div className="space-y-1.5 px-1 text-xs text-rose-600 dark:text-rose-400">
      <p title={schemaError(error)}>Schema unavailable: {schemaError(error)}</p>
      <button type="button" onClick={() => void refetch()} disabled={isFetching} className="rounded border border-rose-200 px-2 py-1 text-[11px] font-medium hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:hover:bg-rose-950">
        {isFetching ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
  if (!data) return null;

  return (
    <div className={compact ? "space-y-1 text-[13px]" : "space-y-3 text-[13px]"}>
      {(() => {
        const tables: QualifiedTable[] = [];
        const views: QualifiedTable[] = [];
        const procedures: QualifiedRoutine[] = [];
        const functions: QualifiedRoutine[] = [];
        const triggers: QualifiedTrigger[] = [];
        for (const schema of data.schemas ?? []) {
          if (schemaFilter && schema.name !== schemaFilter) continue;
          for (const table of schema.tables ?? []) {
            tables.push({
              key: qualifyName(engine, schema.name, table.name),
              schemaName: schema.name,
              table,
            });
          }
          for (const view of schema.views ?? []) {
            views.push({
              key: qualifyName(engine, schema.name, view.name),
              schemaName: schema.name,
              table: view,
            });
          }
          for (const routine of schema.routines ?? []) {
            const item = {
              key: qualifyName(engine, schema.name, routine.name),
              schemaName: schema.name,
              routine,
            };
            if (routine.kind === "procedure") procedures.push(item);
            else functions.push(item);
          }
          for (const trigger of schema.triggers ?? []) {
            triggers.push({
              key: `${qualifyName(engine, schema.name, trigger.table)}.${trigger.name}`,
              schemaName: schema.name,
              trigger,
            });
          }
        }

        const needle = filter.trim().toLowerCase();
        const matches = (key: string) => !needle || key.toLowerCase().includes(needle);
        const visibleViews = views.filter(t => matches(t.key) || t.table.columns.some(c => matches(c.name)));
        const visibleProcedures = procedures.filter(r => matches(r.key));
        const visibleFunctions = functions.filter(r => matches(r.key));
        const visibleTriggers = triggers.filter(t => matches(t.key));
        const filteredTables = tables
          .filter((item) => !needle || item.key.toLowerCase().includes(needle) || (item.table.columns ?? []).some((column) => column.name.toLowerCase().includes(needle)))
          .sort((left, right) => left.key.localeCompare(right.key));

        return (
          <>
            <div className="mb-1.5 flex items-center gap-1">
              <div className="relative min-w-0 flex-1">
                <Icon name="search" size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Search…"
                  title="Search tables, views, routines and column names"
                  aria-label="Search objects or columns"
                  className="h-7 w-full rounded border border-slate-200 bg-white pl-7 pr-2 text-[11px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-cyan-400 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                />
              </div>
              {((data.schemas?.length ?? 0) > 1 || schemaFilter) && (
                <select aria-label="Filter schema" title="Schema" className="h-7 w-24 shrink-0 truncate rounded border border-slate-200 bg-white px-1 text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200" value={schemaFilter} onChange={e => setSchemaFilter(e.target.value)}>
                  <option value="">All schemas</option>
                  {(data.schemas ?? []).map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              )}
              <button
                type="button"
                title={isFetching ? "Refreshing schema…" : "Refresh schema"}
                aria-label="Refresh schema"
                disabled={isFetching}
                onClick={() => void refetch()}
                className="grid h-7 w-7 shrink-0 place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:cursor-wait dark:border-slate-800 dark:hover:bg-slate-900 dark:hover:text-slate-100"
              >
                <Icon name="refresh" size={13} className={isFetching ? "animate-spin" : ""} />
              </button>
            </div>
            {(data.warnings?.length ?? 0) > 0 && (
              <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" title={data.warnings?.join("\n")}>
                Tables and columns loaded. Some optional object metadata is unavailable.
              </div>
            )}
            <div className="mb-1 flex h-6 items-center px-1 text-[11px] font-medium text-slate-400">
              Tables
              <span className="ml-auto rounded border border-slate-200 px-1 text-[10px] font-normal dark:border-slate-800">{filteredTables.length}/{tables.length}</span>
            </div>
            <ul className="space-y-0.5">
              {filteredTables.map((t) => (
                <TableItem key={t.key} engine={engine} schemaName={t.schemaName} table={t.table} connectionId={connectionId} database={database} />
              ))}
              {filteredTables.length === 0 && <li className="px-1 py-1 text-[11px] text-slate-400">No matching tables.</li>}
            </ul>
            {visibleViews.length > 0 && (
              <ObjectGroup label="Views" count={visibleViews.length}>
                {visibleViews.map((t) => (
                  <TableItem key={t.key} engine={engine} schemaName={t.schemaName} table={t.table} icon="grid" connectionId={connectionId} database={database} />
                ))}
              </ObjectGroup>
            )}
            {visibleProcedures.length > 0 && (
              <ObjectGroup label="Procedures" count={visibleProcedures.length}>
                {visibleProcedures.map((r) => (
                  <RoutineItem key={r.key} engine={engine} schemaName={r.schemaName} routine={r.routine} />
                ))}
              </ObjectGroup>
            )}
            {visibleFunctions.length > 0 && (
              <ObjectGroup label="Functions" count={visibleFunctions.length}>
                {visibleFunctions.map((r) => (
                  <RoutineItem key={r.key} engine={engine} schemaName={r.schemaName} routine={r.routine} />
                ))}
              </ObjectGroup>
            )}
            {visibleTriggers.length > 0 && (
              <ObjectGroup label="Triggers" count={visibleTriggers.length}>
                {visibleTriggers.map((t) => (
                  <TriggerItem key={t.key} engine={engine} schemaName={t.schemaName} trigger={t.trigger} />
                ))}
              </ObjectGroup>
            )}
          </>
        );
      })()}
    </div>
  );
}

// Collapsible section for non-table object kinds; collapsed by default so the
// table list keeps its prominence.
function ObjectGroup({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-6 w-full items-center gap-1 rounded px-1 text-left text-[11px] font-medium text-slate-400 hover:bg-slate-50 hover:text-slate-600 dark:hover:bg-slate-900 dark:hover:text-slate-300"
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={12} className="text-slate-300 dark:text-slate-600" />
        {label}
        <span className="ml-auto rounded border border-slate-200 px-1 text-[10px] font-normal text-slate-400 dark:border-slate-800">{count}</span>
      </button>
      {open && <ul className="space-y-0.5">{children}</ul>}
    </div>
  );
}

function RoutineItem({ engine, schemaName, routine }: { engine: string; schemaName: string; routine: RoutineInfo }) {
  const qualifiedName = qualifyName(engine, schemaName, routine.name);
  return (
    <li
      className="flex h-6 items-center gap-1.5 rounded px-1 pl-[18px] text-slate-600 dark:text-slate-400"
      title={`${routine.kind} ${qualifiedName}`}
    >
      <Icon name={routine.kind === "procedure" ? "play" : "wand"} size={12} className="shrink-0 text-slate-400" />
      <span className="truncate">{qualifiedName}</span>
    </li>
  );
}

function TriggerItem({ engine, schemaName, trigger }: { engine: string; schemaName: string; trigger: TriggerInfo }) {
  const qualifiedTable = qualifyName(engine, schemaName, trigger.table);
  return (
    <li
      className="flex h-6 items-center gap-1.5 rounded px-1 pl-[18px] text-slate-600 dark:text-slate-400"
      title={`${trigger.timing} ${trigger.event} ON ${qualifiedTable}`}
    >
      <Icon name="activity" size={12} className="shrink-0 text-slate-400" />
      <span className="truncate">{trigger.name}</span>
      <span className="ml-auto max-w-[45%] shrink-0 truncate text-right text-[10px] text-slate-400">{qualifiedTable}</span>
    </li>
  );
}

function TableItem({ engine, schemaName, table, connectionId, database, icon = "table" }: { engine: string; schemaName: string; table: TableInfo; connectionId: string; database?: string; icon?: IconName }) {
  const action = useContext(SchemaActions);
  const [copyState, setCopyState] = useState<"" | "copied" | "failed">("");
  const [open, setOpen] = useState(false);
  const qualifiedName = qualifyName(engine, schemaName, table.name);
  const quotedName = [schemaName, table.name].map(n => quoteIdentifier(engine, n)).join(".");
  const copyName = () => {
    navigator.clipboard.writeText(quotedName)
      .then(() => setCopyState("copied"), () => setCopyState("failed"))
      .finally(() => window.setTimeout(() => setCopyState(""), 1500));
  };
  return (
    <li>
      <div className="group flex h-7 items-center rounded text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900">
        <button onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1 px-1 text-left">
          <Icon name={open ? "chevron-down" : "chevron-right"} size={13} className="shrink-0 text-slate-400" />
          <Icon name={icon} size={14} className="shrink-0 text-slate-400 group-hover:text-slate-500" />
          <span className="truncate" title={qualifiedName}>{qualifiedName}</span>
        </button>
        <span className={`shrink-0 items-center gap-0.5 pr-1 ${copyState ? "flex" : "hidden group-hover:flex group-focus-within:flex"}`}>
          <RowAction icon="sql" title="Open SELECT in a new tab (does not run it)" onClick={() => action({ connectionId, database, sql: tableSelect(engine, schemaName, table.name, table.columns.map(c => c.name)) })} />
          <RowAction icon={copyState === "copied" ? "check" : "copy"} title={copyState === "failed" ? "Clipboard unavailable" : copyState === "copied" ? "Copied" : `Copy name: ${quotedName}`} onClick={copyName} tone={copyState === "failed" ? "text-rose-500" : copyState === "copied" ? "text-emerald-600" : undefined} />
        </span>
      </div>
      {open && (
        <ul className="ml-[18px] border-l border-slate-200 pl-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          {(table.columns ?? []).map((c) => (
            <li key={c.name} className="flex items-center gap-1.5 py-0.5" title={colTitle(c) + " · Double-click to add column to SQL"} onDoubleClick={() => action({ connectionId, database, sql: quoteIdentifier(engine, c.name), append: true })}>
              {c.pk ? (
                <Icon name="key" size={12} className="shrink-0 text-amber-500" />
              ) : c.references ? (
                <Icon name="key" size={12} className="shrink-0 text-sky-500" />
              ) : (
                <Icon name="columns" size={12} className="shrink-0 text-slate-300 dark:text-slate-600" />
              )}
              <span className={`min-w-0 flex-1 truncate ${c.pk ? "font-medium text-slate-700 dark:text-slate-200" : ""}`}>{c.name}</span>
              {c.pk && <span className="shrink-0 rounded bg-amber-50 px-1 text-[9px] font-medium text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">PK</span>}
              {c.references && <span className="shrink-0 rounded bg-sky-50 px-1 text-[9px] font-medium text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">FK</span>}
              <span className="ml-1 max-w-[38%] shrink-0 truncate text-right text-[10px] tracking-wide text-slate-400">{shortType(c.dataType)}</span>
            </li>
          ))}
          {table.indexes && table.indexes.filter((i) => !i.primary && (i.columns?.length ?? 0) > 0).length > 0 && (
            <li className="mt-1 space-y-0.5 border-t border-slate-100 pt-1 dark:border-slate-800/60">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
                <Icon name="filter" size={11} className="text-slate-300 dark:text-slate-600" />
                Indexes
              </div>
              {table.indexes.filter((i) => !i.primary && (i.columns?.length ?? 0) > 0).map((ix) => (
                <div key={ix.name} className="flex items-center gap-1.5 pl-3.5 py-0.5" title={`${ix.name} (${(ix.columns ?? []).join(", ")})`}>
                  <span className="truncate text-slate-500 dark:text-slate-400">{(ix.columns ?? []).join(", ")}</span>
                  {ix.unique && <span className="shrink-0 rounded bg-slate-100 px-1 text-[9px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">Uniq</span>}
                </div>
              ))}
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function RowAction({ icon, title, onClick, tone }: { icon: IconName; title: string; onClick: () => void; tone?: string }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={`grid h-5 w-5 place-items-center rounded hover:bg-slate-200 dark:hover:bg-slate-800 ${tone ?? "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}>
      <Icon name={icon} size={12} />
    </button>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="px-1 text-xs text-slate-500">{children}</p>;
}

function schemaError(error: unknown) {
  if (error instanceof ApiError) return error.body.message;
  return error instanceof Error ? error.message : "unknown metadata error";
}
