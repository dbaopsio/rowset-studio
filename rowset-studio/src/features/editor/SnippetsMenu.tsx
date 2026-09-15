import { useContext, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../components/Icon";
import { SchemaActions } from "./schemaActions";
import { deleteSavedQuery, listSavedQueries, saveQuery } from "./api";

// A small reusable-query library, separate from full saved-in-a-notebook
// queries: name a statement once, reuse it across sessions for the same
// connection without retyping it. Backed by the existing /saved-queries
// API, which had no UI surface until now.
export default function SnippetsMenu({ connectionId, database, sql }: { connectionId: string | null; database?: string; sql: string }) {
  const action = useContext(SchemaActions);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !container.current?.contains(event.target as Node)) { setOpen(false); setNaming(false); }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  useEffect(() => { if (naming) nameInput.current?.focus(); }, [naming]);

  const { data: all = [] } = useQuery({ queryKey: ["savedQueries"], queryFn: listSavedQueries, enabled: open });
  const items = all.filter((q) => q.connectionId === connectionId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const save = useMutation({
    mutationFn: () => saveQuery({ connectionId, name: name.trim(), sql }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["savedQueries"] }); setNaming(false); setName(""); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSavedQuery(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["savedQueries"] }),
  });

  const trimmedSql = sql.trim();

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Saved snippets for this connection"
        onClick={() => setOpen((v) => !v)}
        disabled={!connectionId}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[12px] text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <Icon name="bookmark" size={13} />
        Snippets
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-72 rounded-md border border-slate-200 bg-white py-1 text-[12px] shadow-lg dark:border-slate-800 dark:bg-slate-900">
          {naming ? (
            <form
              className="flex items-center gap-1.5 px-2 py-1.5"
              onSubmit={(event) => { event.preventDefault(); if (name.trim() && !save.isPending) save.mutate(); }}
            >
              <input
                ref={nameInput}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Snippet name"
                className="h-7 flex-1 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-800 outline-none focus:border-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button type="submit" disabled={!name.trim() || save.isPending} className="h-7 shrink-0 rounded-md bg-brand-600 px-2 text-[11px] font-medium text-white disabled:opacity-50">Save</button>
            </form>
          ) : (
            <button
              type="button"
              disabled={!trimmedSql}
              onClick={() => setNaming(true)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Icon name="plus" size={13} className="shrink-0 text-slate-400" />
              Save current query…
            </button>
          )}
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          {items.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-slate-400">No saved snippets for this connection yet.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {items.map((item) => (
                <div key={item.id} className="group flex items-center gap-1 px-1 py-0.5">
                  <button
                    type="button"
                    title={item.sql}
                    onClick={() => { action({ connectionId: item.connectionId, database, sql: item.sql, append: true }); setOpen(false); }}
                    className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {item.name}
                  </button>
                  <button
                    type="button"
                    title="Delete snippet"
                    onClick={() => remove.mutate(item.id)}
                    className="shrink-0 rounded p-1 text-slate-300 opacity-0 hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-950"
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
