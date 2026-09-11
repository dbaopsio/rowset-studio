import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dropdown } from "../../components/Dropdown";
import { Icon } from "../../components/Icon";
import { useConnections } from "../connections/useConnections";
import { listDatabases } from "./api";

export interface WorkspaceStatus {
  label: string;
  tone: "ok" | "busy" | "warn";
  detail: string;
}

export default function RunToolbar({
  connectionId,
  onConnectionChange,
  onRun,
  onRunAll,
  onExplain,
  onSchedule,
  onOpenFile,
  onSaveFile,
  onExportWorkspace,
  onImportWorkspace,
  onStop,
  manualCommit,
  onManualCommitChange,
  transactionOpen,
  transactionAborted,
  pendingStatements,
  transactionBusy,
  onTransaction,
  onFormat,
  onSave,
  running,
  selectionStatements,
  database,
  onDatabaseChange,
  nodeRole,
  onNodeRoleChange,
}: {
  connectionId: string | null;
  onConnectionChange: (id: string | null) => void;
  onRun: () => void;
  onRunAll: () => void;
  /** Explain the current statement; analyze runs it to measure actual rows. */
  onExplain: (analyze: boolean) => void;
  /** Open the statement under the cursor as a new schedule. */
  onSchedule?: () => void;
  onOpenFile: () => void;
  onSaveFile: () => void;
  onExportWorkspace: () => void;
  onImportWorkspace: () => void;
  onStop: () => void;
  manualCommit: boolean;
  onManualCommitChange: (manual: boolean) => void;
  transactionOpen: boolean;
  transactionAborted: boolean;
  pendingStatements: number;
  transactionBusy: boolean;
  onTransaction: (action: "commit" | "rollback") => void;
  onFormat: () => void;
  onSave: () => void;
  running: boolean;
  /** Statements in the current selection; 0 when nothing is selected. */
  selectionStatements: number;
  database: string;
  onDatabaseChange: (db: string) => void;
  nodeRole: "primary" | "secondary";
  onNodeRoleChange: (role: "primary" | "secondary") => void;
}) {
  const { data: connections } = useConnections();
  const { data: databases = [] } = useQuery({
    queryKey: ["databases", connectionId],
    queryFn: () => listDatabases(connectionId!),
    enabled: Boolean(connectionId),
  });

  const current = connections?.find((c) => c.id === connectionId);
  const dbOptions = databases.length ? databases : current ? [current.database] : [];
  const longestDatabaseName = Math.max(database.length, ...dbOptions.map((item) => item.length), 14);
  const databaseWidth = Math.min(560, Math.max(160, longestDatabaseName * 8.5 + 48));
  const runLabel = running ? "Running…" : selectionStatements > 1 ? `Run ${selectionStatements} statements` : selectionStatements === 1 ? "Run selected" : "Run";
  const runTitle = selectionStatements > 1
    ? "Run the selected statements one after another; each gets its own result (⌘↵)"
    : selectionStatements === 1 ? "Run the selected text (⌘↵)" : "Run the statement under the cursor (⌘↵).\nSelect several statements to run them all, or use Run all (⇧⌘↵).";

  return (
    <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-[#f6f7f9] px-2 py-1 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown
          className="w-56"
          placeholder="Select connection…"
          value={connectionId ?? ""}
          disabled={running || transactionOpen || transactionBusy}
          onChange={(v) => onConnectionChange(v || null)}
          options={(connections ?? []).map((c) => ({ value: c.id, label: c.name, hint: c.engine }))}
        />
        <Dropdown
          className="w-40"
          value={nodeRole}
          disabled={!connectionId || current?.nodePolicy !== "user_selectable" || running || transactionOpen || transactionBusy}
          onChange={(value) => onNodeRoleChange(value as "primary" | "secondary")}
          options={[
            { value: "primary", label: "Primary", hint: current?.nodes.some((n) => n.health === "healthy" && n.detectedRole === "primary") ? "healthy" : "unavailable" },
            { value: "secondary", label: "Secondary", hint: current?.nodes.some((n) => n.health === "healthy" && n.detectedRole === "secondary") ? "read-only" : "unavailable" },
          ]}
        />
        {nodeRole === "secondary" && <span className="rounded bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">Read-only</span>}
        <Dropdown
          searchable
          style={{ width: databaseWidth, maxWidth: "calc(100vw - 2rem)" }}
          menuMinWidth={databaseWidth}
          value={database || current?.database || ""}
          disabled={!connectionId || running || transactionOpen || transactionBusy}
          onChange={onDatabaseChange}
          options={dbOptions.map((db) => ({ value: db, label: db }))}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={onRun}
          disabled={!connectionId || running || transactionBusy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-emerald-700 px-3 text-[13px] font-medium text-white transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          title={runTitle}
        >
          <Icon name="play" size={14} />
          {runLabel}
        </button>
        {running && <button onClick={onStop} className="h-8 rounded-md border border-rose-300 px-2.5 text-[12px] text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950">Stop</button>}
        <CommitModeSwitch
          manual={manualCommit}
          open={transactionOpen}
          aborted={transactionAborted}
          pending={pendingStatements}
          disabled={!connectionId || running || transactionBusy || nodeRole === "secondary"}
          onChange={onManualCommitChange}
        />
        {transactionOpen && <>
          <button onClick={() => onTransaction("commit")} disabled={running || transactionBusy || transactionAborted} className={secondaryButton} title={transactionAborted ? "The database aborted this transaction; Commit would apply nothing" : "Make the pending changes permanent"}>Commit</button>
          <button onClick={() => onTransaction("rollback")} disabled={running || transactionBusy} className={secondaryButton} title="Discard the pending changes">Rollback</button>
        </>}
        <span className="h-5 w-px bg-slate-200 dark:bg-slate-800" />
        <ToolbarButton onClick={() => onExplain(false)} disabled={!connectionId || running || transactionBusy} icon="explain" label="Explain" />
        <ToolbarButton onClick={onFormat} icon="wand" label="Format" />
        <ToolbarButton onClick={onSave} icon="save" label="Save" />
        <MoreMenu items={[
          { label: "Run all statements", hint: "⇧⌘↵ · stops at the first error", onSelect: onRunAll, disabled: !connectionId || running || transactionBusy },
          { label: "Explain with actual rows", hint: "Runs the SELECT to measure it", onSelect: () => onExplain(true), disabled: !connectionId || running || transactionBusy },
          ...(onSchedule ? [{ label: "Schedule this query…", hint: "Save its result to a file on a schedule", onSelect: onSchedule, disabled: !connectionId }] : []),
          { label: "Open .sql file…", onSelect: onOpenFile },
          { label: "Download as .sql", onSelect: onSaveFile },
          { label: "Export workspace (JSON)", onSelect: onExportWorkspace, hint: "All open tabs, not encrypted" },
          { label: "Import workspace…", onSelect: onImportWorkspace, hint: "Adds tabs; never replaces" },
        ]} />
      </div>
    </div>
  );
}

const secondaryButton = "h-8 rounded-md border border-slate-200 bg-white px-2.5 text-[12px] text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800";

// Commit mode, as in DBeaver/DataGrip: switching to manual starts nothing.
// The first statement opens the transaction; Commit/Rollback end it and the
// tab stays in manual mode. Leaving manual mode requires ending it first, so
// the switch never decides what happens to pending changes.
function CommitModeSwitch({ manual, open, aborted, pending, disabled, onChange }: { manual: boolean; open: boolean; aborted: boolean; pending: number; disabled: boolean; onChange: (manual: boolean) => void }) {
  const title = aborted
    ? "The database aborted this transaction after an error. Roll back to continue; Commit would apply nothing."
    : open
      ? `Manual commit: ${pending} statement(s) not committed yet (their locks are held).\nCommit or Rollback before switching back to auto-commit.`
      : manual
        ? "Manual commit: the next statement starts a transaction; nothing is saved until you press Commit.\nClick to return to auto-commit."
        : "Auto-commit: each statement is saved as soon as it succeeds.\nClick for manual commit, to review changes before committing.";
  const track = aborted ? "bg-rose-500" : open ? "bg-amber-500" : manual ? "bg-sky-500" : "bg-slate-300 dark:bg-slate-700";
  const tone = aborted
    ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300"
    : open
      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300";
  return (
    <span title={title} className="inline-flex">
      <button
        type="button"
        role="switch"
        aria-checked={manual}
        aria-label="Manual commit"
        disabled={disabled || open}
        onClick={() => onChange(!manual)}
        className={`inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-[12px] transition disabled:cursor-not-allowed ${open ? "" : "disabled:opacity-50"} ${tone}`}
      >
        <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${track}`}>
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${manual ? "left-3.5" : "left-0.5"}`} />
        </span>
        {aborted ? "Transaction aborted" : open ? `Uncommitted · ${pending}` : manual ? "Manual commit" : "Auto-commit"}
      </button>
    </span>
  );
}

function MoreMenu({ items }: { items: { label: string; hint?: string; disabled?: boolean; onSelect: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return (
    <div ref={container} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} title="Run all, files and workspace" onClick={() => setOpen(value => !value)} className={`${secondaryButton} inline-flex w-8 items-center justify-center px-0`}>
        <Icon name="more" size={14} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-60 rounded-md border border-slate-200 bg-white py-1 text-[12px] shadow-lg dark:border-slate-800 dark:bg-slate-900">
          {items.map(item => (
            <button key={item.label} role="menuitem" type="button" disabled={item.disabled} onClick={() => { setOpen(false); item.onSelect(); }} className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800">
              {item.label}
              {item.hint && <span className="block text-[10px] text-slate-400">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  icon,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: "explain" | "wand" | "save";
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[12px] text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}
