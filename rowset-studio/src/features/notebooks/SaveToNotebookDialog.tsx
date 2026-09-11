import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorText, Field, Input, Modal, Select } from "../../components/ui";
import { createNotebook, getNotebook, listNotebooks, newCell, saveNotebook } from "./api";

// Appends the editor's SQL (with an optional heading) to a notebook.
export default function SaveToNotebookDialog({ sql, connectionId, database, defaultTitle, onClose, onSaved }: {
  sql: string;
  connectionId: string | null;
  database: string;
  defaultTitle: string;
  onClose: () => void;
  onSaved: (notebookTitle: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: notebooks = [], isLoading } = useQuery({ queryKey: ["notebooks"], queryFn: listNotebooks });
  const [target, setTarget] = useState("");
  const [notebookTitle, setNotebookTitle] = useState("My queries");
  const [heading, setHeading] = useState(defaultTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = target || notebooks.find((item) => !item.unreadable)?.id || "new";

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const cells = [
        ...(heading.trim() ? [newCell("markdown", `### ${heading.trim()}`)] : []),
        newCell("sql", sql, { connectionId, database }),
      ];
      let title: string;
      if (chosen === "new") {
        title = notebookTitle.trim() || "My queries";
        await createNotebook({ title, cells });
      } else {
        const notebook = await getNotebook(chosen);
        title = notebook.document.title;
        await saveNotebook(chosen, notebook.revision, { ...notebook.document, cells: [...notebook.document.cells, ...cells] });
        queryClient.removeQueries({ queryKey: ["notebook", chosen] });
      }
      await queryClient.invalidateQueries({ queryKey: ["notebooks"] });
      onSaved(title);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save to the notebook");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Save to notebook" onClose={onClose}>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <Field label="Notebook">
          <Select value={chosen} onChange={(event) => setTarget(event.target.value)} disabled={isLoading}>
            {notebooks.filter((item) => !item.unreadable).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            <option value="new">New notebook…</option>
          </Select>
        </Field>
        {chosen === "new" && (
          <Field label="Notebook name">
            <Input value={notebookTitle} maxLength={200} onChange={(event) => setNotebookTitle(event.target.value)} required />
          </Field>
        )}
        <Field label="Heading for this query (optional)">
          <Input value={heading} maxLength={200} onChange={(event) => setHeading(event.target.value)} />
        </Field>
        <pre className="max-h-32 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">{sql}</pre>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-slate-500">Cancel</button>
          <Button type="submit" disabled={busy || !sql.trim()}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
