import type { TlsMode } from "./api";

export interface ParsedConnectionURL {
  engine: "postgres" | "mysql" | "mariadb" | "sqlserver";
  host: string; port: number; database: string; connectionUsername: string; password: string; tlsMode: TlsMode;
}

const SUPPORTED_OPTIONS = new Set(["sslmode", "ssl", "encrypt", "trustservercertificate", "database", "user", "password"]);

export function parseConnectionURL(raw: string): ParsedConnectionURL {
  const value = raw.trim().replace(/^jdbc:/i, "");
  const url = new URL(value);
  const protocol = url.protocol.toLowerCase();
  const engines: Record<string, ParsedConnectionURL["engine"]> = { "postgres:": "postgres", "postgresql:": "postgres", "mysql:": "mysql", "mariadb:": "mariadb", "sqlserver:": "sqlserver", "mssql:": "sqlserver" };
  const engine = engines[protocol];
  if (!engine) throw new Error("Use a PostgreSQL, MySQL, MariaDB or SQL Server URL.");
  if (url.hash) throw new Error("Encode special characters in the password (for example # as %23).");
  if (!url.hostname || url.hostname.includes(";")) throw new Error("Use a URL with a host and /database; JDBC semicolon properties are not supported.");
  const port = Number(url.port || (engine === "postgres" ? 5432 : engine === "sqlserver" ? 1433 : 3306));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid database port.");
  // Option names are case-insensitive (SQL Server spells TrustServerCertificate
  // in mixed case); values such as passwords keep their case.
  const options = new Map<string, string>();
  for (const [key, option] of url.searchParams) {
    const name = key.toLowerCase();
    if (!SUPPORTED_OPTIONS.has(name)) throw new Error(`URL option "${key}" is not supported; configure it explicitly before connecting.`);
    if (options.has(name)) throw new Error(`Duplicate URL option "${key}" is ambiguous.`);
    options.set(name, option);
  }
  return {
    engine, host: url.hostname.replace(/^\[|\]$/g, ""), port,
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || options.get("database") || "",
    connectionUsername: decodeURIComponent(url.username) || options.get("user") || "",
    password: decodeURIComponent(url.password) || options.get("password") || "",
    tlsMode: urlTLSMode(engine, options),
  };
}

// Never silently downgrade: a URL asking for verification must keep it, and
// modes that may fall back to plaintext are rejected rather than guessed.
function urlTLSMode(engine: ParsedConnectionURL["engine"], options: Map<string, string>): TlsMode {
  const keys = ["sslmode", "ssl", "encrypt"].filter(key => options.has(key));
  if (keys.length > 1) throw new Error("Use only one TLS option in the URL.");
  const trust = options.get("trustservercertificate")?.toLowerCase();
  if (trust !== undefined && (engine !== "sqlserver" || !["true", "false"].includes(trust))) throw new Error("TrustServerCertificate must be true or false and applies only to SQL Server.");
  const unverified = trust === "true";
  const key = keys[0];
  const mode = key ? options.get(key)!.toLowerCase() : undefined;
  const unsupported = () => new Error("This TLS mode cannot be represented. Choose disable, require, verify-ca or verify-full explicitly.");
  switch (key) {
    case undefined: return unverified ? "require" : "verify-full";
    case "sslmode":
      if (mode === "disable" || mode === "require" || mode === "verify-ca" || mode === "verify-full") return unverified && mode !== "disable" ? "require" : mode;
      throw unsupported();
    case "ssl":
      if (["true", "1", "on"].includes(mode!)) return unverified ? "require" : "verify-full";
      if (["false", "0", "off"].includes(mode!)) return "disable";
      throw unsupported();
    default:
      if (["true", "yes", "mandatory", "1"].includes(mode!)) return unverified ? "require" : "verify-full";
      if (["false", "no", "optional", "0", "disable"].includes(mode!)) return "disable";
      throw unsupported();
  }
}
