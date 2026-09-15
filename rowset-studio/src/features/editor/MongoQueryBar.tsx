import { useEffect, useState } from "react";
import { Icon } from "../../components/Icon";
import { mongoPartsToShell, mongoShellToParts, type MongoQueryParts } from "./mongoQuery";

const EMPTY: MongoQueryParts = { collection: "", filter: "{}", project: "{}", sort: "{}", skip: "0", limit: "100", maxTimeMs: "0" };

// A Compass-style bar for the common find() fields, kept in sync with the
// raw db.collection.find() editor below it: typing here rewrites the editor
// text, and switching tabs re-reads the editor text into these fields.
export default function MongoQueryBar({ tabKey, sql, onChange, onRun }: { tabKey: string; sql: string; onChange: (sql: string) => void; onRun: () => void }) {
  const [parts, setParts] = useState<MongoQueryParts>(EMPTY);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    try {
      setParts(mongoShellToParts(sql));
    } catch {
      setParts((current) => ({ ...current, collection: current.collection || "collection" }));
    }
    // Only re-read the editor when switching tabs, so typing in the editor
    // itself does not fight the bar's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKey]);

  const commit = (next: MongoQueryParts) => {
    setParts(next);
    onChange(mongoPartsToShell(next));
  };

  const hasOptions = parts.project.trim() !== "{}" || parts.skip.trim() !== "0" || parts.maxTimeMs.trim() !== "0";

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[12px] font-medium text-slate-500 dark:text-slate-400">Filter</span>
        <input
          value={parts.filter}
          onChange={(event) => commit({ ...parts, filter: event.target.value })}
          onKeyDown={(event) => { if (event.key === "Enter") onRun(); }}
          placeholder="{ field: value }"
          spellCheck={false}
          className="h-8 flex-1 rounded-md border border-slate-300 bg-white px-2.5 font-mono text-[12px] text-slate-800 outline-none focus:border-orange-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-[12px] ${hasOptions ? "border-orange-300 text-orange-700 dark:border-orange-800 dark:text-orange-400" : "border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"}`}
        >
          Options
          <Icon name={expanded ? "chevron-down" : "chevron-right"} className="h-3 w-3" />
        </button>
        <button type="button" onClick={onRun} className="h-8 shrink-0 rounded-md bg-orange-600 px-3 text-[12px] font-medium text-white hover:bg-orange-700">
          Find
        </button>
      </div>
      {expanded && (
        <div className="mt-2 grid grid-cols-5 gap-2">
          <Field label="Project" value={parts.project} mono onCommit={(v) => commit({ ...parts, project: v })} placeholder="{ field: 1 }" />
          <Field label="Sort" value={parts.sort} mono onCommit={(v) => commit({ ...parts, sort: v })} placeholder="{ field: 1 }" />
          <Field label="Skip" value={parts.skip} onCommit={(v) => commit({ ...parts, skip: v })} placeholder="0" />
          <Field label="Limit" value={parts.limit} onCommit={(v) => commit({ ...parts, limit: v })} placeholder="100" />
          <Field label="Max Time MS" value={parts.maxTimeMs} onCommit={(v) => commit({ ...parts, maxTimeMs: v })} placeholder="0" />
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onCommit, placeholder, mono }: { label: string; value: string; onCommit: (v: string) => void; placeholder: string; mono?: boolean }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
      <input
        defaultValue={value}
        key={value}
        onBlur={(event) => onCommit(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        placeholder={placeholder}
        spellCheck={false}
        className={`h-7 rounded-md border border-slate-300 bg-white px-2 text-[12px] text-slate-800 outline-none focus:border-orange-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}
