import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultJSON, resultCSV } from './resultExport.ts';
test('JSON export preserves duplicate labels and exact numeric strings', () => {
  const result={columns:['id','id'],rows:[['9007199254740993',2]]};
  assert.deepEqual(JSON.parse(resultJSON(result)),result);
});
test('CSV escapes carriage returns, quotes and spreadsheet formula text', () => {
  assert.equal(resultCSV({columns:['a'],rows:[['x\ry'],['=1+1'],[-12],['"']]}), 'a\r\n"x\ry"\r\n\'=1+1\r\n-12\r\n""""');
});
