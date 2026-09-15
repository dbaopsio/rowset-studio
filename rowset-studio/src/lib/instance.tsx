import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "./api";

export interface Instance {
  mode: "personal" | "shared";
  desktop: boolean;
  duckdb?: boolean;
}

export function useInstance() {
  return useQuery({ queryKey: ["instance"], queryFn: () => api<Instance>("/meta/instance") });
}

/** True on a shared, multi-user server. */
export function useShared() {
  return useInstance().data?.mode === "shared";
}

// Waits for the server profile before rendering pages that depend on it.
export function InstanceBoundary({ children }: { children: ReactNode }) {
  const { data, isError } = useInstance();
  if (isError) return <div role="alert" className="p-5">Unable to load Rowset. Reload to try again.</div>;
  if (!data) return <div className="p-5">Loading workspace…</div>;
  return children;
}
