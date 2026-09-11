// Thin fetch wrapper: attaches JWT, parses the { error: {...} } envelope, and
// throws ApiError so TanStack Query surfaces failures uniformly. On a 401 it
// transparently refreshes the short-lived access token once and retries.

export interface ApiErrorBody {
  code: string;
  message: string;
  policy?: string;
  risk?: string;
  sqlstate?: string;
  line?: number;
  column?: number;
  number?: number;
  transactionState?: "active" | "aborted" | "lost";
  /** Fields a server extension added to the error. */
  [detail: string]: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = "ApiError";
  }
}

let authToken: string | null = null;
const API_BASE = (import.meta.env.VITE_ROWSET_API_BASE ?? "").replace(/\/+$/, "");

export function setAuthToken(token: string | null) {
  authToken = token;
}

// refreshHandler is installed by the auth module. It attempts a token refresh
// and resolves to the new access token, or null if the session is unrecoverable.
// Kept as a callback to avoid an import cycle between api and auth.
type RefreshHandler = () => Promise<string | null>;
let refreshHandler: RefreshHandler | null = null;
export function setRefreshHandler(fn: RefreshHandler | null) {
  refreshHandler = fn;
}

// A single in-flight refresh is shared by all concurrent 401s.
let refreshing: Promise<string | null> | null = null;
function refreshOnce(): Promise<string | null> {
  if (!refreshHandler) return Promise.resolve(null);
  if (!refreshing) {
    refreshing = refreshHandler().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (authToken) headers.set("Authorization", `Bearer ${authToken}`);
  return fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers,
    // Auth is cookie-backed. Explicitly include credentials even when the
    // embedded studio uses a relative API URL; this keeps refresh behavior
    // consistent behind private-network proxies and alternate hostnames.
    credentials: "include",
    cache: path.startsWith("/auth/") ? "no-store" : init.cache,
  });
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await apiResponse(path, init);
  if (res.status === 204) return undefined as T;
  const data = await res.json();
  return data as T;
}

export async function apiResponse(path: string, init: RequestInit = {}): Promise<Response> {
  let res = await send(path, init);

  // Access token likely expired — refresh once and replay the request.
  if (res.status === 401 && !path.startsWith("/auth/")) {
    const fresh = await refreshOnce();
    if (fresh) res = await send(path, init);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const body: ApiErrorBody =
      data?.error ?? { code: "UNKNOWN", message: res.statusText };
    throw new ApiError(res.status, body);
  }
  return res;
}
