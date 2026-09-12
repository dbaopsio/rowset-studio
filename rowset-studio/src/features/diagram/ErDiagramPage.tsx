import { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Icon } from "../../components/Icon";
import { Input, PageHeader, Panel, Select } from "../../components/ui";
import EngineLogo from "../../components/EngineLogo";
import { useConnections } from "../connections/useConnections";
import { useSchema } from "../editor/useEditor";
import { listDatabases } from "../editor/api";
import { useQuery } from "@tanstack/react-query";

interface DiagramColumn {
  name: string;
  type: string;
  pk: boolean;
  fk: boolean;
}

interface DiagramTable {
  key: string;
  label: string;
  columns: DiagramColumn[];
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DiagramEdge {
  from: string;
  to: string;
  label: string;
}

const COLUMN_HEIGHT = 18;
const HEADER_HEIGHT = 26;
const BOX_WIDTH = 230;
const SHOWN_COLUMNS = 12;
const GAP_X = 90;
const GAP_Y = 60;

// Lays the tables out in columns, most connected first, so related tables sit
// near each other without a layout library.
function layout(tables: { key: string; label: string; columns: DiagramColumn[] }[], edges: DiagramEdge[]): DiagramTable[] {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }
  const ordered = [...tables].sort((a, b) => (degree.get(b.key) ?? 0) - (degree.get(a.key) ?? 0) || a.label.localeCompare(b.label));
  const perColumn = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  const placed: DiagramTable[] = [];
  let x = 0;
  let y = 0;
  let tallest = 0;
  ordered.forEach((table, index) => {
    const height = HEADER_HEIGHT + Math.min(table.columns.length, SHOWN_COLUMNS) * COLUMN_HEIGHT + (table.columns.length > SHOWN_COLUMNS ? COLUMN_HEIGHT : 0);
    placed.push({ ...table, x, y, width: BOX_WIDTH, height });
    tallest = Math.max(tallest, height);
    if ((index + 1) % perColumn === 0) {
      x += BOX_WIDTH + GAP_X;
      y = 0;
      tallest = 0;
    } else {
      y += height + GAP_Y / 2;
    }
  });
  return placed;
}

// A map of the tables in a database and the foreign keys between them.
export default function ErDiagramPage() {
  const [params, setParams] = useSearchParams();
  const { data: connections = [] } = useConnections();
  const connectionId = params.get("connection") ?? connections[0]?.id ?? "";
  const connection = connections.find((item) => item.id === connectionId);
  const { data: databases = [] } = useQuery({
    queryKey: ["databases", connectionId],
    queryFn: () => listDatabases(connectionId),
    enabled: Boolean(connectionId),
  });
  const database = params.get("database") ?? connection?.database ?? "";
  const { data: schema, isLoading, isError, refetch, isFetching } = useSchema(connectionId || null, database || undefined, Boolean(connectionId));
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const { tables, edges } = useMemo(() => {
    const all: { key: string; label: string; columns: DiagramColumn[] }[] = [];
    const links: DiagramEdge[] = [];
    for (const schemaNode of schema?.schemas ?? []) {
      for (const table of schemaNode.tables ?? []) {
        const key = `${schemaNode.name}.${table.name}`;
        all.push({
          key,
          label: schemaNode.name === "default" ? table.name : `${schemaNode.name}.${table.name}`,
          columns: (table.columns ?? []).map((column) => ({ name: column.name, type: column.dataType, pk: Boolean(column.pk), fk: Boolean(column.references) })),
        });
        for (const column of table.columns ?? []) {
          if (!column.references) continue;
          const parts = column.references.split(".");
          const to = parts.length >= 3 ? `${parts[0]}.${parts[1]}` : column.references;
          links.push({ from: key, to, label: column.name });
        }
      }
    }
    const needle = filter.trim().toLowerCase();
    const visible = needle ? all.filter((table) => table.label.toLowerCase().includes(needle)) : all;
    const keys = new Set(visible.map((table) => table.key));
    return { tables: layout(visible, links.filter((edge) => keys.has(edge.from) && keys.has(edge.to))), edges: links.filter((edge) => keys.has(edge.from) && keys.has(edge.to)) };
  }, [schema, filter]);

  const byKey = new Map(tables.map((table) => [table.key, table]));
  const width = Math.max(600, ...tables.map((table) => table.x + table.width + 40));
  const height = Math.max(400, ...tables.map((table) => table.y + table.height + 40));
  const related = (key: string) => !selected || selected === key || edges.some((edge) => (edge.from === selected && edge.to === key) || (edge.to === selected && edge.from === key));

  return (
    <div className="flex h-full flex-col gap-3">
      <PageHeader
        icon="table"
        title="Diagram"
        subtitle="Tables of one database and the foreign keys between them. Drag to move, scroll to zoom."
        actions={
          <button type="button" onClick={() => void refetch()} disabled={isFetching} title="Reload the schema" aria-label="Reload the schema" className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:cursor-wait dark:border-slate-800 dark:bg-slate-900">
            <Icon name="refresh" size={14} className={isFetching ? "animate-spin" : ""} />
          </button>
        }
      />
      <Panel className="flex flex-wrap items-center gap-2 p-2.5">
        <Select aria-label="Connection" value={connectionId} onChange={(event) => setParams({ connection: event.target.value })} className="w-56">
          {connections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <Select aria-label="Database" value={database} onChange={(event) => setParams({ connection: connectionId, database: event.target.value })} className="w-52">
          {(databases.length ? databases : [database]).filter(Boolean).map((item) => <option key={item} value={item}>{item}</option>)}
        </Select>
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter tables…" aria-label="Filter tables" className="pl-8" />
        </div>
        {connection && <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-500"><EngineLogo engine={connection.engine} size={14} />{tables.length} tables · {edges.length} keys</span>}
        <span className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom((value) => Math.max(0.3, value - 0.1))} className="grid h-7 w-7 place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900">−</button>
          <span className="w-10 text-center text-[11px] tabular-nums text-slate-500">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((value) => Math.min(2, value + 0.1))} className="grid h-7 w-7 place-items-center rounded border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900">+</button>
        </span>
      </Panel>
      <Panel className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-sm text-slate-500">Loading the schema…</p>
        ) : isError ? (
          <p className="p-6 text-sm text-rose-600">The schema could not be read. <button className="underline" onClick={() => void refetch()}>Retry</button></p>
        ) : tables.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No tables to draw.</p>
        ) : (
          <div
            className="h-full w-full cursor-grab overflow-hidden active:cursor-grabbing"
            onPointerDown={(event) => { dragging.current = { x: event.clientX - pan.x, y: event.clientY - pan.y }; }}
            onPointerMove={(event) => { if (dragging.current) setPan({ x: event.clientX - dragging.current.x, y: event.clientY - dragging.current.y }); }}
            onPointerUp={() => { dragging.current = null; }}
            onPointerLeave={() => { dragging.current = null; }}
            onWheel={(event) => setZoom((value) => Math.min(2, Math.max(0.3, value - Math.sign(event.deltaY) * 0.1)))}
          >
            <svg width="100%" height="100%" role="img" aria-label="Entity relationship diagram">
              <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                <rect x={0} y={0} width={width} height={height} fill="transparent" />
                {edges.map((edge, index) => {
                  const from = byKey.get(edge.from);
                  const to = byKey.get(edge.to);
                  if (!from || !to) return null;
                  const active = selected === edge.from || selected === edge.to;
                  const x1 = from.x + from.width;
                  const y1 = from.y + HEADER_HEIGHT / 2 + 8;
                  const x2 = to.x;
                  const y2 = to.y + HEADER_HEIGHT / 2 + 8;
                  const mid = (x1 + x2) / 2;
                  return (
                    <path
                      key={`${edge.from}-${edge.to}-${edge.label}-${index}`}
                      d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      strokeWidth={active ? 2 : 1}
                      className={active ? "stroke-brand-500" : "stroke-slate-300 dark:stroke-slate-700"}
                    >
                      <title>{`${edge.from}.${edge.label} → ${edge.to}`}</title>
                    </path>
                  );
                })}
                {tables.map((table) => (
                  <g key={table.key} transform={`translate(${table.x} ${table.y})`} onClick={() => setSelected((current) => (current === table.key ? "" : table.key))} className="cursor-pointer">
                    <rect width={table.width} height={table.height} rx={6} className={`${related(table.key) ? "fill-white dark:fill-slate-900" : "fill-white/40 dark:fill-slate-900/40"} ${selected === table.key ? "stroke-brand-500" : "stroke-slate-200 dark:stroke-slate-700"}`} strokeWidth={selected === table.key ? 2 : 1} />
                    <rect width={table.width} height={HEADER_HEIGHT} rx={6} className="fill-slate-100 dark:fill-slate-800" />
                    <text x={10} y={HEADER_HEIGHT - 9} className="fill-slate-800 text-[12px] font-medium dark:fill-slate-100">{table.label}</text>
                    {table.columns.slice(0, SHOWN_COLUMNS).map((column, index) => (
                      <g key={column.name} transform={`translate(0 ${HEADER_HEIGHT + index * COLUMN_HEIGHT})`}>
                        <text x={10} y={13} className={`text-[11px] ${column.pk ? "fill-amber-600 dark:fill-amber-400" : column.fk ? "fill-sky-600 dark:fill-sky-400" : "fill-slate-600 dark:fill-slate-300"}`}>
                          {column.pk ? "PK " : column.fk ? "FK " : ""}{column.name}
                        </text>
                        <text x={table.width - 10} y={13} textAnchor="end" className="fill-slate-400 text-[10px]">{column.type}</text>
                      </g>
                    ))}
                    {table.columns.length > SHOWN_COLUMNS && (
                      <text x={10} y={HEADER_HEIGHT + SHOWN_COLUMNS * COLUMN_HEIGHT + 13} className="fill-slate-400 text-[10px]">+{table.columns.length - SHOWN_COLUMNS} more columns</text>
                    )}
                  </g>
                ))}
              </g>
            </svg>
          </div>
        )}
      </Panel>
    </div>
  );
}
