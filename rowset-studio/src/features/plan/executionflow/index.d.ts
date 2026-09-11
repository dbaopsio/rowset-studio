export interface PlanStatement {
  [key: string]: unknown;
}

export interface ParsedPlan {
  ok: boolean;
  error?: string;
  statements: PlanStatement[];
}

export function parsePlanFor(engine: string, text: string): ParsedPlan;
export function renderPlan(statement: PlanStatement, index: number): HTMLElement;
