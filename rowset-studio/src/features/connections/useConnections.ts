import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ConnectionInput,
  createConnection,
  deleteConnection,
  listConnections,
  testConnection,
  updateConnection,
} from "./api";

const KEY = ["connections"];

export function useConnections() {
  return useQuery({ queryKey: KEY, queryFn: listConnections });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectionInput) => createConnection(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ConnectionInput }) => updateConnection(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteConnection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useTestConnection() {
  return useMutation({ mutationFn: (id: string) => testConnection(id) });
}
