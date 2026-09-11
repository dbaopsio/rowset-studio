// Custom select: a styled trigger + floating listbox, replacing the native
// <select> so the open menu matches the app (theme-aware, consistent chrome).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

export function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  className = "",
  searchable = false,
  style,
  menuMinWidth,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  searchable?: boolean;
  style?: React.CSSProperties;
  menuMinWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const selected = options.find((o) => o.value === value);
  const visibleOptions = search
    ? options.filter((option) => `${option.label} ${option.hint ?? ""}`.toLowerCase().includes(search.toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function positionMenu() {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const estimatedHeight = Math.min(256, Math.max(40, options.length * 36 + 8));
      const openAbove = window.innerHeight - rect.bottom < estimatedHeight && rect.top > estimatedHeight;
      const viewportPadding = 8;
      const width = Math.min(Math.max(rect.width, menuMinWidth ?? rect.width), window.innerWidth - viewportPadding * 2);
      const left = Math.min(Math.max(viewportPadding, rect.left), window.innerWidth - width - viewportPadding);
      setMenuStyle({
        position: "fixed",
        left,
        top: openAbove ? rect.top - estimatedHeight - 4 : rect.bottom + 4,
        width,
      });
    }
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [menuMinWidth, open, options.length]);

  return (
    <div ref={ref} className={`relative ${className}`} style={style}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800 transition hover:border-slate-300 focus:border-cyan-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-slate-700 ${
          open ? "border-cyan-500 dark:border-cyan-500" : ""
        }`}
      >
        <span className={`truncate ${selected ? "" : "text-slate-400"}`} title={selected?.label}>{selected ? selected.label : placeholder}</span>
        <Icon name="chevron-down" size={14} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && createPortal(
        <div ref={menuRef} style={menuStyle} className="z-[100] max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {searchable && (
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search…"
              className="mb-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[13px] outline-none focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          )}
          {visibleOptions.length === 0 && <div className="px-2 py-1.5 text-[13px] text-slate-400">No matches</div>}
          {visibleOptions.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                  setSearch("");
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] transition ${
                  active
                    ? "bg-cyan-50 text-slate-900 dark:bg-cyan-500/15 dark:text-slate-50"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 whitespace-normal break-words" title={o.label}>{o.label}</span>
                  {o.hint && <span className="shrink-0 text-[11px] text-slate-400">{o.hint}</span>}
                </span>
                {active && <Icon name="check" size={13} className="shrink-0 text-cyan-600 dark:text-cyan-300" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
