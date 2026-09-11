import { api } from "../../lib/api";

export interface PolicyRole {
  id: string;
  name: string;
}

// Roles a policy can be scoped to, where the server provides them.
export function listRoles() {
  return api<{ roles: PolicyRole[] | null }>("/roles").then((r) => r.roles ?? []);
}
