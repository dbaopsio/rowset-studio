import { useState } from "react";
import { Modal, Select } from "../../components/ui";
import PolicyBanner from "./PolicyBanner";
import { discardImport, runImport, startImport, uploadImportChunk, type TableInfo } from "./api";
import { detectDelimiter, parseCsv, type Delimiter } from "./csv";

const PREVIEW_BYTES = 256 * 1024;
const CHUNK_BYTES = 512 * 1024;
const DELIMITER_LABELS: Record<Delimiter, string> = { ",": "Comma", ";": "Semicolon", "\t": "Tab", "|": "Pipe" };

type Phase = "choose" | "uploading" | "importing" | "done" | "error";

// Imports a CSV file into an existing table. The file uploads in chunks and
// is inserted in one transaction, so either every row lands or none does.
export default function CsvImportDialog({ connectionId, database, schemaName, table, onClose }: { connectionId: string; database?: string; schemaName: string; table: TableInfo; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [delimiter, setDelimiter] = useState<Delimiter>(",");
  const [header, setHeader] = useState(true);
  const [nullEmpty, setNullEmpty] = useState(true);
  const [mapping, setMapping] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("choose");
  const [progress, setProgress] = useState(0);
  const [imported, setImported] = useState<{ rows: number; durationMs: number } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const rows = text ? parseCsv(text, delimiter, 51) : [];
  const previewRows = truncated && rows.length === 51 ? rows.slice(0, 50) : rows;
  const width = Math.max(0, ...previewRows.map((row) => row.length));
  const headings = header && previewRows[0] ? previewRows[0] : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  const sample = header ? previewRows.slice(1, 8) : previewRows.slice(0, 7);
  const used = mapping.filter(Boolean);
  const duplicate = used.find((name, index) => used.indexOf(name) !== index);
  const busy = phase === "uploading" || phase === "importing";

  function autoMap(nextRows: string[][], withHeader: boolean) {
    const columns = table.columns.map((column) => column.name);
    const count = Math.max(0, ...nextRows.map((row) => row.length));
    setMapping(Array.from({ length: count }, (_, index) => {
      if (withHeader) {
        const name = (nextRows[0]?.[index] ?? "").trim().toLowerCase();
        return columns.find((column) => column.toLowerCase() === name) ?? "";
      }
      return columns[index] ?? "";
    }));
  }

  async function choose(next: File | undefined) {
    if (!next) return;
    const head = await next.slice(0, PREVIEW_BYTES).text();
    const detected = detectDelimiter(head);
    setFile(next);
    setText(head);
    setTruncated(next.size > PREVIEW_BYTES);
    setDelimiter(detected);
    setPhase("choose");
    setError(null);
    autoMap(parseCsv(head, detected, 51), header);
  }

  async function importFile() {
    if (!file) return;
    setError(null);
    setPhase("uploading");
    let importId = "";
    try {
      importId = (await startImport(connectionId)).importId;
      for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
        await uploadImportChunk(connectionId, importId, file.slice(offset, offset + CHUNK_BYTES));
        setProgress(Math.min(100, Math.round(((offset + CHUNK_BYTES) / file.size) * 100)));
      }
      setPhase("importing");
      const result = await runImport(connectionId, importId, {
        schema: schemaName,
        table: table.name,
        database: database ?? "",
        header,
        delimiter: delimiter === "\t" ? "\\t" : delimiter,
        nullEmpty,
        columns: mapping.map((target, source) => ({ source, target })).filter((column) => column.target),
      });
      setImported(result);
      setPhase("done");
    } catch (err) {
      if (importId) void discardImport(connectionId, importId).catch(() => undefined);
      setError(err);
      setPhase("error");
    }
  }

  return (
    <Modal title={`Import CSV into ${schemaName ? `${schemaName}.` : ""}${table.name}`} onClose={() => !busy && onClose()} size="xl" closeOnBackdrop={false}>
      <div className="space-y-4 text-[13px]">
        {phase === "done" && imported ? (
          <div className="space-y-3">
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              Imported {imported.rows.toLocaleString()} row{imported.rows === 1 ? "" : "s"} into {table.name} in {(imported.durationMs / 1000).toFixed(1)} s.
            </p>
            <div className="flex justify-end"><button type="button" onClick={onClose} className="inline-flex h-8 items-center rounded-md bg-brand-600 px-3 font-medium text-white hover:bg-brand-500">Done</button></div>
          </div>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-slate-600 dark:text-slate-300">CSV file</span>
              <input type="file" accept=".csv,.tsv,.txt,text/csv" disabled={busy} onChange={(event) => void choose(event.target.files?.[0])} className="block w-full text-[12px]" />
            </label>

            {file && (
              <>
                <div className="flex flex-wrap items-end gap-4">
                  <label className="w-40">
                    <span className="mb-1 block text-[12px] font-medium text-slate-600 dark:text-slate-300">Delimiter</span>
                    <Select value={delimiter} disabled={busy} onChange={(event) => { const next = event.target.value as Delimiter; setDelimiter(next); autoMap(parseCsv(text, next, 51), header); }}>
                      {(Object.keys(DELIMITER_LABELS) as Delimiter[]).map((key) => <option key={key} value={key}>{DELIMITER_LABELS[key]}</option>)}
                    </Select>
                  </label>
                  <label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={header} disabled={busy} onChange={(event) => { setHeader(event.target.checked); autoMap(rows, event.target.checked); }} />First row is a header</label>
                  <label className="flex items-center gap-2 pb-2"><input type="checkbox" checked={nullEmpty} disabled={busy} onChange={(event) => setNullEmpty(event.target.checked)} />Empty values become NULL</label>
                  <span className="ml-auto pb-2 text-[12px] text-slate-500">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                </div>

                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
                  <table className="min-w-full text-left text-[12px]">
                    <thead className="bg-slate-50 dark:bg-slate-900">
                      <tr>
                        {headings.map((heading, index) => (
                          <th key={index} className="min-w-[140px] border-b border-r border-slate-200 px-2 py-1.5 align-top font-medium dark:border-slate-800">
                            <div className="mb-1 truncate text-slate-500" title={heading}>{heading}</div>
                            <Select value={mapping[index] ?? ""} disabled={busy} onChange={(event) => setMapping((current) => current.map((value, i) => (i === index ? event.target.value : value)))}>
                              <option value="">Skip</option>
                              {table.columns.map((column) => <option key={column.name} value={column.name}>{column.name} · {column.dataType}</option>)}
                            </Select>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sample.map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-slate-100 dark:border-slate-800">
                          {headings.map((_, index) => <td key={index} className="max-w-[220px] truncate border-r border-slate-100 px-2 py-1 font-mono dark:border-slate-800">{row[index] ?? ""}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-slate-500">Showing the first rows. Values are sent as text; the database converts them to each column's type. Table columns left out get their defaults.</p>

                {duplicate && <p className="text-[12px] text-rose-600">{duplicate} is chosen for more than one CSV column.</p>}
                {phase === "error" && <PolicyBanner error={error} />}
                <div className="flex items-center justify-end gap-2">
                  {busy && <span className="mr-auto text-[12px] text-slate-500">{phase === "uploading" ? `Uploading ${progress}%` : "Importing in one transaction…"}</span>}
                  <button type="button" onClick={onClose} disabled={busy} className="inline-flex h-8 items-center rounded-md border border-slate-200 px-3 text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button>
                  <button type="button" onClick={() => void importFile()} disabled={busy || !used.length || Boolean(duplicate)} className="inline-flex h-8 items-center rounded-md bg-brand-600 px-3 font-medium text-white hover:bg-brand-500 disabled:opacity-50">Import</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
