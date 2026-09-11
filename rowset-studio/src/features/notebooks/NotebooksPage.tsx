import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { Input, PageHeader, Panel, Select, Textarea } from "../../components/ui";
import { Icon } from "../../components/Icon";
import { ApiError } from "../../lib/api";
import { useConnections } from "../connections/useConnections";
import { createNotebook, deleteNotebook, getNotebook, listNotebooks, newCell, saveNotebook, type Notebook, type NotebookCell, type NotebookDocument } from "./api";
import { headingText } from "./markdown";
import { notebookFileName, notebookToMarkdown, notebookToSQL } from "./exportNotebook";
import MarkdownView from "./MarkdownView";

// Notebooks keep notes and SQL side by side. SQL cells are never executed
// here: "Open in editor" copies the cell into a new editor tab.
export default function NotebooksPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("id");
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["notebooks"], queryFn: listNotebooks });
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const notebooks = list.data ?? [];
  const visible = notebooks.filter((item) => item.title.toLowerCase().includes(search.trim().toLowerCase()));
  const activeId = selectedId && notebooks.some((item) => item.id === selectedId) ? selectedId : notebooks[0]?.id;

  async function create() {
    setCreating(true);
    setError("");
    try {
      const created = await createNotebook({ title: "Untitled notebook", cells: [newCell("markdown", "# Untitled notebook")] });
      await queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      setParams({ id: created.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the notebook");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PageHeader icon="notebook" title="Notebooks" subtitle="Notes and SQL kept together. SQL cells open in the editor as a new tab; they never run from here." actions={
        <button type="button" onClick={() => void create()} disabled={creating} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-[12px] font-medium text-white hover:bg-brand-500 disabled:opacity-50">
          <Icon name="plus" size={13} />New notebook
        </button>
      } />
      {error && <p role="alert" className="text-[12px] text-rose-600">{error}</p>}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-slate-200 p-2 dark:border-slate-800">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notebooks…" aria-label="Search notebooks" />
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1">
            {list.isLoading && <li className="p-3 text-[12px] text-slate-500">Loading…</li>}
            {list.isError && <li className="p-3 text-[12px] text-rose-600">Notebooks unavailable. <button className="underline" onClick={() => void list.refetch()}>Retry</button></li>}
            {!list.isLoading && !notebooks.length && <li className="p-3 text-[12px] text-slate-500">No notebooks yet. Create one, or use Save in the editor.</li>}
            {visible.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => setParams({ id: item.id })} className={`block w-full rounded px-2.5 py-2 text-left ${item.id === activeId ? "bg-slate-100 dark:bg-slate-800" : "hover:bg-slate-50 dark:hover:bg-slate-900"}`}>
                  <span className="block truncate text-[13px] font-medium text-slate-800 dark:text-slate-100">{item.title}</span>
                  <span className="block text-[11px] text-slate-400">{item.unreadable ? "Unreadable" : `${item.cellCount} cells`} · {new Date(item.updatedAt).toLocaleDateString()}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
        {activeId ? <NotebookEditor key={activeId} id={activeId} onDeleted={() => setParams({})} /> : (
          <Panel className="grid place-items-center p-10 text-[13px] text-slate-500">Select or create a notebook.</Panel>
        )}
      </div>
    </div>
  );
}

function NotebookEditor({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const query = useQuery({ queryKey: ["notebook", id], queryFn: () => getNotebook(id), staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false });
  if (query.isLoading) return <Panel className="p-6 text-[13px] text-slate-500">Loading notebook…</Panel>;
  if (query.isError || !query.data) return <Panel className="p-6 text-[13px] text-rose-600">{query.error instanceof Error ? query.error.message : "Notebook unavailable."} <button className="underline" onClick={() => void query.refetch()}>Retry</button></Panel>;
  return <LoadedNotebook initial={query.data} onDeleted={onDeleted} onReload={() => void query.refetch()} />;
}

type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

function LoadedNotebook({ initial, onDeleted, onReload }: { initial: Notebook; onDeleted: () => void; onReload: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: connections = [] } = useConnections();
  const [doc, setDoc] = useState<NotebookDocument>(initial.document);
  const [state, setState] = useState<SaveState>("saved");
  const revision = useRef(initial.revision);
  const pending = useRef<NotebookDocument | null>(null);
  const saving = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const flush = useRef<() => void>(() => undefined);
  flush.current = () => {
    window.clearTimeout(timer.current);
    if (saving.current || !pending.current) return;
    const body = pending.current;
    pending.current = null;
    saving.current = true;
    setState("saving");
    saveNotebook(initial.id, revision.current, body).then((result) => {
      revision.current = result.revision;
      saving.current = false;
      void queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      if (pending.current) flush.current();
      else setState("saved");
    }, (error) => {
      saving.current = false;
      pending.current ??= body;
      setState(error instanceof ApiError && error.status === 409 ? "conflict" : "error");
    });
  };
  useEffect(() => () => flush.current(), []);

  function update(next: NotebookDocument) {
    setDoc(next);
    pending.current = next;
    setState("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flush.current(), 700);
  }
  const setCell = (index: number, patch: Partial<NotebookCell>) => update({ ...doc, cells: doc.cells.map((cell, position) => position === index ? { ...cell, ...patch } : cell) });
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= doc.cells.length) return;
    const cells = [...doc.cells];
    [cells[index], cells[target]] = [cells[target], cells[index]];
    update({ ...doc, cells });
  };
  const remove = (index: number) => update({ ...doc, cells: doc.cells.filter((_, position) => position !== index) });
  const add = (kind: NotebookCell["kind"]) => update({ ...doc, cells: [...doc.cells, newCell(kind)] });

  function openInEditor(index: number) {
    const cell = doc.cells[index];
    const heading = doc.cells.slice(0, index).reverse().find((item) => item.kind === "markdown");
    navigate("/editor", { state: { openSql: cell.content, connectionId: cell.connectionId ?? null, database: cell.database ?? "", title: (heading && headingText(heading.content)) || doc.title } });
  }

  function download(format: "md" | "sql") {
    const names = Object.fromEntries(connections.map((connection) => [connection.id, connection.name]));
    const text = format === "md" ? notebookToMarkdown(doc, names) : notebookToSQL(doc, names);
    const url = URL.createObjectURL(new Blob([text], { type: format === "md" ? "text/markdown;charset=utf-8" : "application/sql;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = notebookFileName(doc.title, format);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function removeNotebook() {
    if (!window.confirm(`Delete “${doc.title}”? This cannot be undone.`)) return;
    try {
      window.clearTimeout(timer.current);
      pending.current = null;
      await deleteNotebook(initial.id);
      await queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      onDeleted();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const status = { saved: "All changes saved", dirty: "Unsaved changes…", saving: "Saving…", conflict: "Changed elsewhere — reload to continue", error: "Save failed — will retry on the next edit" }[state];
  return (
    <Panel className="flex min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-2.5 dark:border-slate-800">
        <input value={doc.title} maxLength={200} aria-label="Notebook title" onChange={(event) => update({ ...doc, title: event.target.value })} onBlur={() => { if (!doc.title.trim()) update({ ...doc, title: "Untitled notebook" }); }}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-[15px] font-semibold text-slate-900 outline-none hover:border-slate-200 focus:border-cyan-400 dark:text-slate-50 dark:hover:border-slate-700" />
        <span className={`text-[11px] ${state === "conflict" || state === "error" ? "text-amber-600" : "text-slate-400"}`}>{status}</span>
        {state === "conflict" && <button type="button" onClick={onReload} className="rounded border px-2 py-1 text-[12px]">Reload</button>}
        <button type="button" onClick={() => download("md")} title="Export as Markdown: notes as written, SQL in code blocks" className="rounded border border-slate-200 px-2 py-1 text-[12px] text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900">Export .md</button>
        <button type="button" onClick={() => download("sql")} title="Export as a SQL script: notes become comments" className="rounded border border-slate-200 px-2 py-1 text-[12px] text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900">Export .sql</button>
        <button type="button" onClick={() => void removeNotebook()} title="Delete notebook" aria-label="Delete notebook" className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"><Icon name="close" size={13} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {doc.cells.length === 0 && <p className="p-4 text-center text-[13px] text-slate-500">This notebook is empty. Add a note or a SQL cell.</p>}
        {doc.cells.map((cell, index) => (
          <CellView key={cell.id} cell={cell} first={index === 0} last={index === doc.cells.length - 1} connections={connections}
            onChange={(patch) => setCell(index, patch)} onMove={(delta) => move(index, delta)} onRemove={() => remove(index)} onOpen={() => openInEditor(index)} />
        ))}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => add("markdown")} className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"><Icon name="plus" size={12} />Note</button>
          <button type="button" onClick={() => add("sql")} className="inline-flex items-center gap-1 rounded border border-dashed border-slate-300 px-2.5 py-1 text-[12px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"><Icon name="plus" size={12} />SQL</button>
        </div>
      </div>
    </Panel>
  );
}

function CellView({ cell, first, last, connections, onChange, onMove, onRemove, onOpen }: {
  cell: NotebookCell; first: boolean; last: boolean; connections: { id: string; name: string }[];
  onChange: (patch: Partial<NotebookCell>) => void; onMove: (delta: number) => void; onRemove: () => void; onOpen: () => void;
}) {
  const [editing, setEditing] = useState(cell.kind === "sql" || !cell.content.trim());
  const [copied, setCopied] = useState(false);
  const rows = Math.min(20, Math.max(3, cell.content.split("\n").length + 1));
  const tool = "grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-100";
  return (
    <div className="group rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-2 py-1 dark:border-slate-900">
        <span className={`rounded px-1.5 text-[10px] font-medium uppercase tracking-wide ${cell.kind === "sql" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>{cell.kind === "sql" ? "SQL" : "Note"}</span>
        {cell.kind === "sql" && <>
          <Select aria-label="Connection" value={cell.connectionId ?? ""} onChange={(event) => onChange({ connectionId: event.target.value || null })} className="h-7 w-44 text-[12px]">
            <option value="">No connection</option>
            {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
          </Select>
          <input value={cell.database ?? ""} onChange={(event) => onChange({ database: event.target.value })} placeholder="default database" aria-label="Database" className="h-7 w-36 rounded border border-slate-200 bg-transparent px-2 text-[12px] outline-none focus:border-cyan-400 dark:border-slate-800" />
          <button type="button" onClick={onOpen} disabled={!cell.content.trim()} title="Open this SQL in a new editor tab; it is not run" className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-700 px-2.5 text-[12px] font-medium text-white hover:bg-emerald-600 disabled:opacity-40"><Icon name="sql" size={12} />Open in editor</button>
          <button type="button" className={tool} title={copied ? "Copied" : "Copy SQL"} aria-label="Copy SQL" onClick={() => { void navigator.clipboard.writeText(cell.content).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }, () => undefined); }}><Icon name={copied ? "check" : "copy"} size={12} /></button>
        </>}
        {cell.kind === "markdown" && !editing && <button type="button" className={tool} title="Edit note" aria-label="Edit note" onClick={() => setEditing(true)}><Icon name="pencil" size={12} /></button>}
        {cell.kind === "markdown" && editing && <button type="button" className="rounded px-1.5 text-[11px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setEditing(false)}>Done</button>}
        <span className="ml-auto flex items-center gap-0.5 opacity-60 group-hover:opacity-100">
          <button type="button" className={tool} disabled={first} title="Move up" aria-label="Move up" onClick={() => onMove(-1)}><Icon name="chevron-down" size={12} className="rotate-180" /></button>
          <button type="button" className={tool} disabled={last} title="Move down" aria-label="Move down" onClick={() => onMove(1)}><Icon name="chevron-down" size={12} /></button>
          <button type="button" className={tool} title="Delete cell" aria-label="Delete cell" onClick={onRemove}><Icon name="close" size={12} /></button>
        </span>
      </div>
      <div className="p-2">
        {cell.kind === "markdown" && !editing ? (
          <div className="cursor-text px-1" onDoubleClick={() => setEditing(true)}><MarkdownView source={cell.content} /></div>
        ) : (
          <Textarea rows={rows} spellCheck={false} value={cell.content} onChange={(event) => onChange({ content: event.target.value })}
            placeholder={cell.kind === "sql" ? "SELECT …" : "# Heading, **bold**, *italic*, `code`, - lists, [links](https://…)"}
            className={cell.kind === "sql" ? "font-mono text-[12px]" : "text-[13px]"} />
        )}
      </div>
    </div>
  );
}
