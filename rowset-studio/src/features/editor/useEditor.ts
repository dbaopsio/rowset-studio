import { useQuery } from "@tanstack/react-query";
import { getSchema, listHistory } from "./api";

export function useHistory(connectionId: string | null) {
  return useQuery({
    queryKey: ["history", connectionId],
    queryFn: () =>
      listHistory(connectionId!, {
        from: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        to: new Date().toISOString(),
      }),
    enabled: !!connectionId,
  });
}

export function useSchema(connectionId: string | null, database?: string, enabled = true) {
  return useQuery({
    queryKey: ["schema", connectionId, database ?? ""],
    queryFn: () => getSchema(connectionId!, database),
    enabled: !!connectionId && enabled,
    // Objects created since the last look show up when a database is
    // expanded again, without pressing refresh.
    staleTime: 5 * 60_000,
    refetchOnMount: true,
  });
}
