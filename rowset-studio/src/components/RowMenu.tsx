import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

const MENU_WIDTH = 200;

// The ⋯ button of a tree row. The menu is portaled so scrolling panels
// never clip it.
export default function RowMenu({ label, items, className = "" }: { label: string; items: RowMenuItem[]; className?: string }) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!position) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setPosition(null);
        return;
      }
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setPosition(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [position]);

  const toggle = () => {
    if (position || !button.current) {
      setPosition(null);
      return;
    }
    const rect = button.current.getBoundingClientRect();
    const height = items.length * 30 + 8;
    const top = rect.bottom + 4 + height > window.innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4;
    setPosition({ top, left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)) });
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        onClick={toggle}
        className={`grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 ${className}`}
      >
        <Icon name="more" size={14} />
      </button>
      {position && createPortal(
        <div ref={menu} role="menu" style={{ top: position.top, left: position.left, width: MENU_WIDTH }} className="fixed z-50 rounded-md border border-slate-200 bg-white py-1 text-[12.5px] shadow-lg dark:border-slate-800 dark:bg-slate-900">
          {items.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              type="button"
              disabled={item.disabled}
              onClick={() => { setPosition(null); item.onSelect(); }}
              className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
