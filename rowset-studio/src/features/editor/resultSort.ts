function decimal(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value));
  if (!match || !(match[2] || match[3])) return null;
  const digits = (match[2] + (match[3] ?? "")).replace(/^0+/, "");
  if (!digits) return { sign: 0, digits: "0", magnitude: 0n };
  return { sign: match[1] === "-" ? -1 : 1, digits,
    magnitude: BigInt(digits.length) + BigInt(match[4] ?? "0") - BigInt((match[3] ?? "").length) };
}

function compareDecimal(a: unknown, b: unknown): number | null {
  const left = decimal(a), right = decimal(b);
  if (!left || !right) return null;
  if (left.sign !== right.sign) return left.sign - right.sign;
  if (!left.sign) return 0;
  if (left.magnitude !== right.magnitude) return (left.magnitude < right.magnitude ? -1 : 1) * left.sign;
  const size = Math.max(left.digits.length, right.digits.length);
  const l = left.digits.padEnd(size, "0"), r = right.digits.padEnd(size, "0");
  return (l < r ? -1 : l > r ? 1 : 0) * left.sign;
}

export function compareCells(a: unknown, b: unknown, type = "", direction: "asc" | "desc" = "asc"): number {
  // NULL remains last in both directions; textual IDs are not coerced to numbers.
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  const numeric = /^(?:u?int\d*|smallint|bigint|tinyint|mediumint|integer|smallserial|serial|bigserial|decimal|numeric|number|float\d*|double(?: precision)?|real|money|smallmoney)(?:\b|\()/i.test(type);
  const comparison = numeric || (typeof a === "number" && typeof b === "number") ? compareDecimal(a, b) : null;
  return (comparison ?? String(a).localeCompare(String(b))) * (direction === "asc" ? 1 : -1);
}
