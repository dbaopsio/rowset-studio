import { compareCells } from "./resultSort.ts";
export type FilterOperator = "contains" | "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "null" | "notNull";
export interface ResultFilter { column: number; operator: FilterOperator; value: string }
export function matchesFilter(row: unknown[], filter: ResultFilter, types: string[] = []): boolean {
  const candidates = filter.column < 0 ? row.map((value, index) => ({ value, type: types[index] })) : [{ value: row[filter.column], type: types[filter.column] }];
  return candidates.some(({ value, type }) => {
    if (filter.operator === "null") return value == null;
    if (filter.operator === "notNull") return value != null;
    if (value == null) return false;
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    if (filter.operator === "contains") return text.toLocaleLowerCase().includes(filter.value.toLocaleLowerCase());
    const compared = compareCells(text, filter.value, type || (typeof value === "number" ? "number" : ""));
    switch (filter.operator) {
      case "eq": return compared === 0;
      case "neq": return compared !== 0;
      case "gt": return compared > 0;
      case "gte": return compared >= 0;
      case "lt": return compared < 0;
      case "lte": return compared <= 0;
    }
  });
}
export function filteredIndexes(rows: unknown[][], filters: ResultFilter[], types?: string[]): number[] {
  const indexes: number[] = [];
  rows.forEach((row, index) => { if (filters.every(filter => matchesFilter(row, filter, types))) indexes.push(index); });
  return indexes;
}
