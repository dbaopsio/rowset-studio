/* Rowset entry to the executionflow parsers and plan renderer. */
import { parsePlan as parseSqlServer } from './parsers/sqlserver.js';
import { parsePlan as parseMySql } from './parsers/mysql.js';
import { parsePlan as parsePostgres } from './parsers/postgres.js';

export { renderPlan } from './view.js';

export function parsePlanFor(engine, text) {
  try {
    switch (engine) {
      case 'postgres': return parsePostgres(text);
      case 'mysql':
      case 'mariadb': return parseMySql(text);
      case 'mssql':
      case 'sqlserver': return parseSqlServer(text);
      default: return { ok: false, error: 'Execution plans are not supported for ' + engine + '.', statements: [] };
    }
  } catch {
    return { ok: false, error: 'Could not read the execution plan.', statements: [] };
  }
}
