// CSV parsing for the import preview. The server parses the full file with
// the same rules: quoted fields may contain delimiters, quotes ("") and line
// breaks; a stray quote inside an unquoted field is kept as text.

export type Delimiter = "," | ";" | "\t" | "|";

const DELIMITERS: Delimiter[] = [",", ";", "\t", "|"];

/** Picks the delimiter that splits the first line into the most fields. */
export function detectDelimiter(sample: string): Delimiter {
  const firstLine = parseCsv(sample, ",", 1)[0]?.join(",") ?? "";
  let best: Delimiter = ",";
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (char === delimiter && !quoted) count++;
    }
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/** Parses up to maxRows records. */
export function parseCsv(text: string, delimiter: string, maxRows = Number.POSITIVE_INFINITY): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let atFieldStart = true;
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
    field = "";
    atFieldStart = true;
  };
  for (; index < text.length && rows.length < maxRows; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
      atFieldStart = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      endRow();
    } else {
      field += char;
      atFieldStart = false;
    }
  }
  if (rows.length < maxRows && (field !== "" || row.length)) endRow();
  return rows;
}
