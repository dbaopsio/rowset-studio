// Small shared UI primitives (Tailwind). Kept minimal and dependency-free.
import { Icon, type IconName } from "./Icon";
import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Children, isValidElement, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Dropdown, type Option } from "./Dropdown";

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-transparent bg-brand-600 px-3 text-[13px] font-medium text-white shadow-[0_1px_2px_rgba(52,20,13,0.25)] transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-brand-500 dark:hover:bg-brand-400 ${className}`}
      {...props}
    />
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800 placeholder-slate-400 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:bg-slate-900 ${className}`}
      {...props}
    />
  );
}

export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 ${className}`}>
      <span className="text-[12px] font-medium text-slate-600 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="text-[13px] text-rose-600 dark:text-rose-400">{children}</p>;
}

export function Select({ className = "", children, value, defaultValue, onChange, disabled, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = useMemo(() => optionsFromChildren(children), [children]);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(String(defaultValue ?? options[0]?.value ?? ""));
  const selected = String(controlled ? value : inner);

  function change(next: string) {
    if (!controlled) setInner(next);
    onChange?.({ target: { value: next } } as ChangeEvent<HTMLSelectElement>);
  }

  return (
    <Dropdown
      className={className}
      value={selected}
      onChange={change}
      disabled={disabled}
      placeholder={props["aria-label"] ?? "Select..."}
      options={options}
    />
  );
}

function optionsFromChildren(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child)) return [];
    if (child.props.disabled) return [];
    const label = textFromNode(child.props.children);
    return [{ value: String(child.props.value ?? label), label }];
  });
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  return "";
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-900 ${className}`}
      {...props}
    />
  );
}

export function Panel({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <section className={`rounded-md border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${className} dark:border-slate-800 dark:bg-slate-950`}>{children}</section>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
      <div className="flex items-start gap-3">
        {icon && (
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <Icon name={icon} size={15} />
          </span>
        )}
        <div className="space-y-1">
          <h1 className="text-[17px] font-semibold tracking-normal text-slate-900 dark:text-slate-50">{title}</h1>
          {subtitle && <p className="max-w-3xl text-[12px] leading-5 text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warn" | "danger" | "info" }) {
  const tones: Record<string, string> = {
    neutral: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300",
    success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300",
    warn: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300",
    danger: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300",
    info: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-400/20 dark:bg-cyan-500/10 dark:text-cyan-300",
  };
  return <span className={`inline-flex h-5 items-center rounded border px-1.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

// SegTabs: underline tab-bar for in-page filtering/segmenting. Active tab carries
// an ink underline (no accent color needed), optional leading icon and a count.
export function SegTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: { value: T; label: string; icon?: IconName; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-0.5 border-b border-slate-200 dark:border-slate-800 ${className}`}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            onClick={() => onChange(t.value)}
            className={`relative -mb-px flex h-9 items-center gap-1.5 border-b-2 px-3 text-[13px] transition ${
              active
                ? "border-slate-900 font-medium text-slate-900 dark:border-slate-100 dark:text-slate-100"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {t.icon && <Icon name={t.icon} size={15} className={active ? "" : "opacity-70"} />}
            {t.label}
            {typeof t.count === "number" && (
              <span
                className={`ml-0.5 rounded px-1 text-[11px] tabular-nums ${
                  active ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" : "text-slate-400"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Modal renders a centered dialog over a dimmed backdrop. Portaled to <body>
// so the fixed overlay always spans the viewport, even when an ancestor creates
// a containing block (transform/filter).
export function Modal({
  title,
  onClose,
  children,
  closeOnBackdrop = false,
  showCloseButton = true,
  size = "md",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeOnBackdrop?: boolean;
  showCloseButton?: boolean;
  size?: "md" | "lg" | "xl";
}) {
  const widths = {
    md: "max-w-md",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  };
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/40 p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className={`flex max-h-[calc(100dvh-2rem)] w-full ${widths[size]} flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-950`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          {showCloseButton && (
            <button
              type="button"
              title="Close"
              onClick={onClose}
              className="rounded p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain pr-1">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
