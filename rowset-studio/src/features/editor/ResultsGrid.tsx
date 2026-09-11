import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { useActiveExtensions } from "../../app/extensions";
import { Modal } from "../../components/ui";
import { QueryResult } from "./api";
import { editTarget, updateStatements, type EditTarget } from "./rowEdits";
import { resultCSV, resultJSON } from "./resultExport";
import { compareCells } from "./resultSort";

// Renders a query result set. Values are rendered as text; NULL is shown
// explicitly. Sorting and exports cover the currently received, bounded rows.
export interface ResultEditing {
  engine: string;
  /** Primary-key column names of a table, or null when it has none. */
  primaryKey: (schema: string, table: string) => string[] | null;
  /** Runs the UPDATE statements through the editor, then reloads the result. */
  onApply: (statements: string[]) => void;
}

type CellEdits = Map<number, Map<number, string | null>>;

function cellText(value: unknown) {
  return value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
}

export default function ResultsGrid({ result, editing }: { result: QueryResult; editing?: ResultEditing }) {
  const [view, setView] = useState<"grid" | "text">("grid");
  const target = useMemo(() => (editing ? editTarget(result.columnOrigins, editing.primaryKey) : null), [editing, result.columnOrigins]);
  const [editMode, setEditMode] = useState(false);
  const [edits, setEdits] = useState<CellEdits>(() => new Map());
  const [reviewing, setReviewing] = useState(false);
  const changeCount = [...edits.values()].reduce((count, row) => count + row.size, 0);
  const statements = useMemo(
    () => (editing && target ? updateStatements(editing.engine, target, [...edits.entries()].map(([row, values]) => ({ row: result.rows[row], values })), result.columnTypes) : []),
    [editing, target, edits, result.rows],
  );

  // A new result starts clean.
  useEffect(() => {
    setEdits(new Map());
    setEditMode(false);
  }, [result]);

  function setCell(row: number, column: number, value: string | null) {
    setEdits((current) => {
      const next = new Map(current);
      const values = new Map(next.get(row) ?? []);
      const original = result.rows[row]?.[column];
      if (value === null ? original == null : original != null && cellText(original) === value) values.delete(column);
      else values.set(column, value);
      if (values.size) next.set(row, values);
      else next.delete(row);
      return next;
    });
  }

  if (result.columns.length === 0) {
    return (
      <p className="p-3 text-[13px] text-emerald-700 dark:text-emerald-300">
        OK · {result.rowCount} row(s) affected · {result.durationMs}ms
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 items-center gap-2 border-b border-slate-200 bg-white px-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center gap-0.5 rounded-md border border-slate-200 p-0.5 dark:border-slate-800">
          <ViewToggle active={view === "grid"} onClick={() => setView("grid")} icon="grid" label="Grid" />
          <ViewToggle active={view === "text"} onClick={() => setView("text")} icon="text" label="Text" />
        </div>
        <span className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
        {editing && (
          <button
            type="button"
            disabled={!target}
            onClick={() => setEditMode((value) => !value)}
            title={target ? "Double-click a cell to change it" : "Editing needs a result from one table that includes its primary key"}
            className={`flex h-6 items-center gap-1 rounded px-2 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${editMode ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}
          >
            <Icon name="pencil" size={12} />
            {editMode ? `Editing ${target?.table ?? ""}` : "Edit rows"}
          </button>
        )}
        {changeCount > 0 && (
          <>
            <button type="button" onClick={() => setReviewing(true)} className="flex h-6 items-center rounded bg-emerald-600 px-2 font-medium text-white hover:bg-emerald-500">
              Review {changeCount} change{changeCount === 1 ? "" : "s"}
            </button>
            <button type="button" onClick={() => setEdits(new Map())} className="flex h-6 items-center rounded px-2 font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
              Discard
            </button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <ExportButton result={result} kind="csv" />
          <ExportButton result={result} kind="json" />
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {view === "grid" ? <GridView result={result} editable={editMode ? target : null} edits={edits} onEdit={setCell} /> : <TextView result={result} />}
      </div>
      {reviewing && editing && (
        <Modal title="Apply changes" onClose={() => setReviewing(false)} size="lg">
          <div className="space-y-3">
            <p className="text-[13px] text-slate-600 dark:text-slate-300">
              These statements run in the editor like any query, so policies apply and, in manual commit mode, nothing is saved until you press Commit. The result reloads afterwards.
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-100">{statements.map((statement) => statement + ";").join("\n")}</pre>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReviewing(false)} className="inline-flex h-8 items-center rounded-md border border-slate-200 px-3 text-[13px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
              <button type="button" disabled={!statements.length} onClick={() => { editing.onApply(statements); setReviewing(false); setEdits(new Map()); setEditMode(false); }} className="inline-flex h-8 items-center rounded-md bg-emerald-600 px-3 text-[13px] font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
                Apply {statements.length} statement{statements.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function GridView({ result, editable, edits, onEdit }: { result: QueryResult; editable?: EditTarget | null; edits?: CellEdits; onEdit?: (row: number, column: number, value: string | null) => void }) {
  const [editingCell, setEditingCell] = useState<{ row: number; column: number; text: string } | null>(null);
  const Mark = useActiveExtensions().find((item) => item.columnMark)?.columnMark;
  const [cellView, setCellView] = useState<{ column: string; value: unknown } | null>(null);
  const [copyState, setCopyState] = useState("");
  const [widths, setWidths] = useState<Record<number, number>>({});
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const rowHeight = 32;
  const overscan = 16;

  function toggleSort(col: number) {
    setSort((s) => (!s || s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null));
  }

  // Row order as indexes into result.rows, so edits stay tied to their row.
  const order = useMemo(() => {
    const indexes = result.rows.map((_, index) => index);
    if (!sort) return indexes;
    const { col, dir } = sort;
    return indexes.sort((a, b) => compareCells(result.rows[a][col], result.rows[b][col], result.columnTypes?.[col], dir));
    // rowCount grows while a result streams in; the array itself is reused.
  }, [result.rows, result.rowCount, result.columnTypes, sort]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const height = Math.floor(entries[0]?.contentRect.height ?? 0);
      setViewportHeight(height);
    });
    observer.observe(el);
    setViewportHeight(Math.floor(el.clientHeight));
    return () => observer.disconnect();
  }, []);

  const totalRows = order.length;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight) + overscan * 2);
  const end = Math.min(totalRows, start + visibleCount);
  const visibleRows = order.slice(start, end);
  const paddingTop = start * rowHeight;
  const paddingBottom = Math.max(0, (totalRows - end) * rowHeight);

  return (
    <>
    <div ref={scrollerRef} className="h-full overflow-auto" onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}>
      <table className="min-w-full text-left text-xs">
        <thead className="sticky top-0 z-10 bg-[#f3f4f6] text-slate-500 dark:bg-slate-900 dark:text-slate-400">
          <tr>
            <th className="w-12 border-b border-r border-slate-200 px-2 py-1.5 font-medium dark:border-slate-800">#</th>
            {result.columns.map((c, ci) => {
              const active = sort?.col === ci;
              return (
                <th
                  key={`${ci}:${c}`}
                  onClick={() => toggleSort(ci)}
                  className="cursor-pointer select-none whitespace-nowrap border-b border-r border-slate-200 px-2 py-1.5 font-medium hover:bg-slate-200/50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  title="Sort by this column"
                  style={{ minWidth: widths[ci] ?? 120, width: widths[ci] }}
                >
                  <div className="flex items-center gap-1.5">
                    {Mark && <Mark result={result} column={c} />}
                    <span className="text-slate-700 dark:text-slate-200">
                      {c}
                    </span>
                    {result.columnTypes?.[ci] && <span className="text-[10px] font-normal text-slate-400">{result.columnTypes[ci]}</span>}
                    <Icon
                      name={active ? "chevron-down" : "sort"}
                      size={11}
                      className={`transition ${active ? "text-brand-500" : "text-slate-300 dark:text-slate-600"} ${active && sort?.dir === "asc" ? "rotate-180" : ""}`}
                    />
                    <span role="separator" aria-label={`Resize ${c}`} className="-mr-2 ml-auto h-5 w-2 shrink-0 cursor-col-resize border-r-2 border-transparent hover:border-slate-400 dark:hover:border-slate-500" onClick={event => event.stopPropagation()} onPointerDown={event => {
                      event.preventDefault(); event.stopPropagation();
                      const start = event.clientX, width = event.currentTarget.closest("th")?.getBoundingClientRect().width ?? 120;
                      const move = (ev: PointerEvent) => setWidths(current => ({ ...current, [ci]: Math.max(70, Math.min(1200, width + ev.clientX - start)) }));
                      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
                      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
                    }} />
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {paddingTop > 0 && (
            <tr aria-hidden="true">
              <td colSpan={result.columns.length + 1} style={{ height: `${paddingTop}px`, border: 0, padding: 0 }} />
            </tr>
          )}
          {visibleRows.map((rowIndex, i) => {
            const row = result.rows[rowIndex];
            const rowEdits = edits?.get(rowIndex);
            return (
              <tr key={rowIndex} style={{ height: rowHeight }} className="hover:bg-slate-50 dark:hover:bg-slate-900">
                <td className="whitespace-nowrap border-r border-slate-100 px-2 py-1.5 text-slate-400 dark:border-slate-800 dark:text-slate-500">{start + i + 1}</td>
                {row.map((cell, j) => {
                  const canEdit = Boolean(editable && editable.columns[j] && !editable.key.includes(j));
                  const changed = Boolean(rowEdits?.has(j));
                  const shown = changed ? rowEdits!.get(j) : cell;
                  const inEdit = editingCell?.row === rowIndex && editingCell.column === j;
                  const commit = (value: string | null) => { onEdit?.(rowIndex, j, value); setEditingCell(null); };
                  return (
                    <td
                      key={j}
                      title={canEdit ? "Double-click to edit" : "Double-click to inspect or copy"}
                      onDoubleClick={() => {
                        if (canEdit) { setEditingCell({ row: rowIndex, column: j, text: cellText(shown) }); return; }
                        setCopyState(""); setCellView({ column: result.columns[j], value: cell });
                      }}
                      style={{ maxWidth: widths[j] ?? 480 }}
                      className={`overflow-hidden text-ellipsis whitespace-nowrap border-r border-slate-100 px-2 py-1.5 text-slate-700 dark:border-slate-800 dark:text-slate-200 ${changed ? "bg-amber-50 dark:bg-amber-500/10" : ""}`}
                    >
                      {inEdit ? (
                        <span className="flex items-center gap-1">
                          <input
                            autoFocus
                            value={editingCell.text}
                            onChange={(event) => setEditingCell({ row: rowIndex, column: j, text: event.target.value })}
                            onKeyDown={(event) => { if (event.key === "Enter") commit(editingCell.text); if (event.key === "Escape") setEditingCell(null); }}
                            onBlur={() => commit(editingCell.text)}
                            className="h-6 w-full min-w-[80px] rounded border border-sky-400 bg-white px-1 font-mono text-[12px] outline-none dark:bg-slate-900"
                          />
                          <button type="button" title="Set NULL" onMouseDown={(event) => { event.preventDefault(); commit(null); }} className="rounded border border-slate-300 px-1 text-[10px] text-slate-500 dark:border-slate-600">NULL</button>
                        </span>
                      ) : renderCell(shown)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {paddingBottom > 0 && (
            <tr aria-hidden="true">
              <td colSpan={result.columns.length + 1} style={{ height: `${paddingBottom}px`, border: 0, padding: 0 }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
    {cellView && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6" role="presentation" onClick={() => setCellView(null)}>
      <div role="dialog" aria-modal="true" aria-label={`Cell ${cellView.column}`} className="w-full max-w-3xl space-y-3 rounded-lg bg-white p-5 dark:bg-slate-900" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between"><strong>{cellView.column}</strong><button onClick={() => setCellView(null)}>Close</button></div>
        <textarea readOnly className="h-80 w-full rounded border bg-transparent p-2 font-mono text-xs" value={cellView.value == null ? "NULL" : typeof cellView.value === "object" ? JSON.stringify(cellView.value, null, 2) : String(cellView.value)} />
        <button className="rounded border px-3 py-1" onClick={() => { const value = cellView.value == null ? "NULL" : typeof cellView.value === "object" ? JSON.stringify(cellView.value, null, 2) : String(cellView.value); void navigator.clipboard.writeText(value).then(() => setCopyState("Copied"), () => setCopyState("Clipboard unavailable; select and copy the text above.")); }}>Copy value</button>
        <span role="status" className="ml-3 text-xs">{copyState}</span>
      </div>
    </div>}
    </>
  );
}

function TextView({ result }: { result: QueryResult }) {
  const header = result.columns.join("\t");
  const body = result.rows.map((r) => r.map((c) => (c === null || c === undefined ? "NULL" : String(c))).join("\t")).join("\n");
  return (
    <pre className="whitespace-pre p-3 font-mono text-xs leading-5 text-slate-700 dark:text-slate-200">{header + "\n" + body}</pre>
  );
}

function ViewToggle({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: "grid" | "text"; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-6 items-center gap-1.5 rounded px-2 font-medium transition ${
        active ? "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
      }`}
    >
      <Icon name={icon} size={13} />
      {label}
    </button>
  );
}

function ExportButton({ result, kind }: { result: QueryResult; kind: "csv" | "json" }) {
  return (
    <button
      onClick={() => downloadResult(result, kind)}
      className="flex h-6 items-center gap-1 rounded border border-slate-200 bg-white px-2 font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      title={`Export results as ${kind.toUpperCase()}`}
    >
      <Icon name="save" size={12} />
      {kind.toUpperCase()}
    </button>
  );
}

function downloadResult(result: QueryResult, kind: "csv" | "json") {
  let content: string;
  let mime: string;
  if (kind === "json") {
    content = resultJSON(result);
    mime = "application/json";
  } else {
    content = resultCSV(result);
    mime = "text/csv";
  }
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rowset-results-${Date.now()}.${kind}`;
  a.click();
  URL.revokeObjectURL(url);
}

function renderCell(v: unknown) {
  if (v === null || v === undefined) return <span className="text-slate-400">NULL</span>;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
