import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { useActiveExtensions } from "../../app/extensions";
import { QueryResult } from "./api";
import { resultCSV, resultJSON } from "./resultExport";
import { compareCells } from "./resultSort";

// Renders a query result set. Values are rendered as text; NULL is shown
// explicitly. Sorting and exports cover the currently received, bounded rows.
export default function ResultsGrid({ result }: { result: QueryResult }) {
  const [view, setView] = useState<"grid" | "text">("grid");

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
        <div className="ml-auto flex items-center gap-1">
          <ExportButton result={result} kind="csv" />
          <ExportButton result={result} kind="json" />
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {view === "grid" ? <GridView result={result} /> : <TextView result={result} />}
      </div>
    </div>
  );
}

function GridView({ result }: { result: QueryResult }) {
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

  const rows = useMemo(() => {
    if (!sort) return result.rows;
    const { col, dir } = sort;
    return [...result.rows].sort((a, b) => compareCells(a[col], b[col], result.columnTypes?.[col], dir));
  }, [result.rows, result.columnTypes, sort]);

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

  const totalRows = rows.length;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight) + overscan * 2);
  const end = Math.min(totalRows, start + visibleCount);
  const visibleRows = rows.slice(start, end);
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
                    <span role="separator" aria-label={`Resize ${c}`} className="ml-auto h-4 w-2 cursor-col-resize bg-slate-200 dark:bg-slate-700" onClick={event => event.stopPropagation()} onPointerDown={event => {
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
          {visibleRows.map((row, i) => (
            <tr key={start + i} style={{ height: rowHeight }} className="hover:bg-slate-50 dark:hover:bg-slate-900">
              <td className="whitespace-nowrap border-r border-slate-100 px-2 py-1.5 text-slate-400 dark:border-slate-800 dark:text-slate-500">{start + i + 1}</td>
              {row.map((cell, j) => (
                <td key={j} title="Double-click to inspect or copy" onDoubleClick={() => { setCopyState(""); setCellView({ column: result.columns[j], value: cell }); }} style={{ maxWidth: widths[j] ?? 480 }} className="overflow-hidden text-ellipsis whitespace-nowrap border-r border-slate-100 px-2 py-1.5 text-slate-700 dark:border-slate-800 dark:text-slate-200">
                  {renderCell(cell)}
                </td>
              ))}
            </tr>
          ))}
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
