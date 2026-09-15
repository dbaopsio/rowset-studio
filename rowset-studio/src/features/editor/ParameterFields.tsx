import type { QueryParameter, QueryParameters as Values } from "./queryParameters";
export default function QueryParameters({ names, values, onChange }: { names: string[]; values: Values; onChange: (values: Values) => void }) {
  if (!names.length) return null;
  const field = "h-7 rounded border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900";
  return <div className="max-h-40 shrink-0 space-y-1 overflow-auto border-b border-slate-200 px-3 py-2 dark:border-slate-800">
    <p className="text-[11px] text-slate-500">Parameters · {"{{name}}"} inserts a typed value · values stay in this session; executed queries appear in history</p>
    {names.map(name => {
      const parameter = Object.hasOwn(values, name) ? values[name] : undefined;
      const update = (patch: Partial<QueryParameter>) => onChange({ ...values, [name]: { ...(parameter ?? { type: "text", value: "" }), ...patch } });
      return <div key={name} className="flex items-center gap-2"><label className="w-32 truncate font-mono text-xs" htmlFor={`parameter-${name}`}>{name}</label>
        <select aria-label={`${name} type`} className={field} value={parameter?.type ?? "text"} onChange={e => update({ type: e.target.value as QueryParameter["type"], value: e.target.value === "boolean" ? "true" : parameter?.value ?? "" })}><option value="text">Text</option><option value="number">Number</option><option value="boolean">Boolean</option><option value="null">NULL</option></select>
        {parameter?.type === "boolean" ? <select id={`parameter-${name}`} className={field} value={parameter.value} onChange={e => update({ value: e.target.value })}><option value="true">true</option><option value="false">false</option></select> : parameter?.type !== "null" && <input id={`parameter-${name}`} className={`${field} min-w-0 flex-1`} value={parameter?.value ?? ""} placeholder="Set value" onChange={e => update({ value: e.target.value })} />}
        {!parameter && <button className="text-[11px] text-slate-500 underline" onClick={() => update({ value: "" })}>Use empty text</button>}
      </div>;
    })}
  </div>;
}
