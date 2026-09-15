import type { ReactNode } from "react";
import postgresLogo from "../assets/engines/postgres.png";
import mysqlLogo from "../assets/engines/mysql.png";
import mariadbLogo from "../assets/engines/mariadb.png";
import mssqlLogo from "../assets/engines/mssql.svg";
import mongodbLogo from "../assets/engines/mongodb.svg";
import clickhouseLogo from "../assets/engines/clickhouse.svg";

export type EngineLogoName = "postgres" | "mysql" | "mariadb" | "mssql" | string;

const labels: Record<string, string> = {
  sqlite: "SQLite", duckdb: "DuckDB", clickhouse: "ClickHouse", mongodb: "MongoDB",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mssql: "SQL Server",
  sqlserver: "SQL Server",
  cockroachdb: "CockroachDB",
  redis: "Redis",
  cassandra: "Cassandra",
  elasticsearch: "Elasticsearch",
  snowflake: "Snowflake",
};

export function engineLabel(engine: string) {
  return labels[engine.toLowerCase()] ?? engine;
}

const logos: Record<string, string> = {
  mongodb: mongodbLogo,
  clickhouse: clickhouseLogo,
  postgres: postgresLogo,
  postgresql: postgresLogo,
  mysql: mysqlLogo,
  mariadb: mariadbLogo,
  mssql: mssqlLogo,
  sqlserver: mssqlLogo,
};

export default function EngineLogo({
  engine,
  size = 18,
  className = "",
}: {
  engine: EngineLogoName;
  size?: number;
  className?: string;
}) {
  const key = engine.toLowerCase();
  const logo = logos[key];
  if (logo) {
    return (
      <img
        src={logo}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={`shrink-0 object-contain ${key === "clickhouse" ? "dark:invert" : ""} ${className}`}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {fallbackGlyph}
    </svg>
  );
}

const fallbackGlyph: ReactNode = (
  <>
    <ellipse cx="12" cy="6" fill="#64748B" rx="8" ry="3.5" />
    <path fill="#94A3B8" d="M4 6v10c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5V6c0 1.9-3.6 3.5-8 3.5S4 7.9 4 6Z" />
    <path fill="#64748B" d="M4 11c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5v2c0 1.9-3.6 3.5-8 3.5S4 14.9 4 13v-2Z" opacity=".8" />
  </>
);
