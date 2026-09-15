import test from 'node:test';
import assert from 'node:assert/strict';
import { parameterNames, resolveParameters } from './queryParameters.ts';

test('only unquoted placeholders are parameters, with engine-aware comments', () => {
  const sql = `SELECT {{id}}, '{{string}}', "{{column}}", $$ {{body}} $$ /* {{block}} */ -- {{line}}\nFROM #temp WHERE id={{id}} AND n={{other}}`;
  assert.deepEqual(parameterNames(sql,'postgres'),['id','other']);
  assert.deepEqual(parameterNames('SELECT 1 # {{hidden}}\n, {{shown}}','mysql'),['shown']);
  assert.deepEqual(parameterNames('SELECT {{ constructor }}','sqlite'),['constructor']);
  assert.throws(()=>resolveParameters('SELECT {{constructor}}','sqlite',{}),/Set parameter/);
});
test('typed values retain digits and cannot inject statements', () => {
  const input = "x\\'; DROP TABLE t; --";
  const values = {id:{type:'number',value:'9007199254740993'},name:{type:'text',value:input},enabled:{type:'boolean',value:'true'},nil:{type:'null',value:''}};
  assert.equal(resolveParameters('SELECT {{id}}, {{enabled}}, {{nil}}','sqlite',values),'SELECT 9007199254740993, 1, NULL');
  assert.equal(resolveParameters('SELECT {{name}}','sqlite',values),`SELECT 'x\\''; DROP TABLE t; --'`);
  assert.match(resolveParameters('SELECT {{name}}','mysql',values),/^SELECT CONVERT\(X'[0-9a-f]+' USING utf8mb4\)$/);
  assert.match(resolveParameters('SELECT {{name}}','clickhouse',values),/^SELECT unhex\('[0-9a-f]+'\)$/);
  assert.match(resolveParameters('SELECT {{name}}','sqlserver',values),/^SELECT N'/);
  assert.throws(()=>resolveParameters('SELECT {{id}}','sqlite',{id:{type:'number',value:'1; DROP TABLE t'}}),/valid number/);
  assert.throws(()=>resolveParameters('SELECT {{missing}}','sqlite',values),/Set parameter missing/);
});
test('replacement does not interpret placeholders inside a value', () => {
  assert.equal(resolveParameters('SELECT {{name}}, {{name}}','sqlite',{name:{type:'text',value:'{{unknown}}'}}),"SELECT '{{unknown}}', '{{unknown}}'");
});
