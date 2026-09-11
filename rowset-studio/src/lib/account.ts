import { api } from "./api";

// Changes an account password; the server ends that account's sessions.
export function setUserPassword(userId: string, password: string) {
  return api<void>(`/users/${userId}/password`, {
    method: "PATCH",
    body: JSON.stringify({ password }),
  });
}
