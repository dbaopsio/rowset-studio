import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readQueryStream } from './queryStream.ts';
const { Response } = globalThis;

test('query stream preserves exact values and reports progress and completion', async () => {
  const records=[{type:'columns',columns:['id'],columnTypes:['INT8']},{type:'rows',rows:[['9007199254740993']]},{type:'complete',rowCount:1,durationMs:42,truncated:true}];
  const seen=[];
  const result=await readQueryStream(new Response(records.map(r=>JSON.stringify(r)).join('\n')),r=>seen.push(r));
  assert.equal(result.rows[0][0],'9007199254740993');assert.equal(result.durationMs,42);assert.equal(seen.length,1);assert.equal(result.truncated,true);
});
test('malformed rows and inconsistent completion counts are rejected', async () => {
  await assert.rejects(readQueryStream(new Response('{"type":"columns","columns":["id"]}\n{"type":"rows","rows":[[1,2]]}\n')),/Invalid query row batch/);
  await assert.rejects(readQueryStream(new Response('{"type":"columns","columns":[]}\n{"type":"complete","rowCount":5,"durationMs":1}\n')),/Invalid query completion/);
});
test('a large result is streamed rather than cut off by a hidden size limit', async () => {
  const rows = Array.from({ length: 5000 }, (_, i) => `[${i},"${'x'.repeat(400)}"]`).join(',');
  const body = `{"type":"columns","columns":["id","payload"]}\n{"type":"rows","rows":[${rows}]}\n{"type":"complete","rowCount":5000,"durationMs":3}\n`;
  const result = await readQueryStream(new Response(body));
  assert.equal(result.rows.length, 5000);
  assert.equal(result.rowCount, 5000);
});
test('interrupted and failed streams are not reported as successful', async () => {
  await assert.rejects(readQueryStream(new Response('{"type":"columns","columns":[]}\n')),/interrupted/);
  await assert.rejects(readQueryStream(new Response('{"type":"columns","columns":[]}\n{"type":"complete","error":"database timeout"}\n')),/database timeout/);
});
