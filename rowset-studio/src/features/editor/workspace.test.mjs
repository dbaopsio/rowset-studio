import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validWorkspace, WorkspaceWriter, mergeWorkspace } from './workspace.ts';

const doc = sql => ({ version: 1, activeTabId: 'q1', tabs: [{ id: 'q1', title: 'Draft', sql, database: 'CaseDb' }] });

test('workspace validates shape, active tab and duplicate IDs', () => {
  assert(validWorkspace(doc('SELECT 1')));
  for (const invalid of [null, {}, { ...doc(''), version: 2 }, { ...doc(''), activeTabId: 'missing' },
    { ...doc(''), tabs: [doc('').tabs[0], doc('').tabs[0]] }, { ...doc(''), tabs: [null] }]) assert(!validWorkspace(invalid));
});

test('writer serializes requests and coalesces edits with the acknowledged revision', async () => {
  const calls = []; let finish;
  const writer = new WorkspaceWriter({ revision: 4, document: doc('old') }, doc('one'), (revision, document) => {
    calls.push({ revision, document });
    return calls.length === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ revision: revision + 1 });
  }, () => {});
  const first = writer.flush();
  writer.update(doc('two')); writer.flush(); writer.update(doc('three')); writer.flush();
  assert.equal(calls.length, 1);
  finish({ revision: 5 }); await first;
  assert.deepEqual(calls.map(call => [call.revision, call.document.tabs[0].sql]), [[4, 'one'], [5, 'three']]);
  assert.equal(writer.revision, 6); assert.equal(writer.dirty, false);
});

test('conflict preserves unsaved drafts and never retries or advances revision implicitly', async () => {
  let calls = 0;
  const writer = new WorkspaceWriter({ revision: 2, document: doc('server') }, doc('mine'), async () => { calls++; throw new Error('WORKSPACE_CONFLICT'); }, () => {});
  await writer.flush(); writer.update(doc('new edits')); await writer.flush();
  assert.equal(calls, 1); assert.equal(writer.revision, 2); assert(writer.dirty); assert.equal(writer.current.tabs[0].sql, 'new edits');
  await writer.retry(); assert.equal(calls, 2); assert.equal(writer.error.message, 'WORKSPACE_CONFLICT');
});

test('missing server workspace is created and oversized drafts never sent', async () => {
  let calls = 0;
  const writer = new WorkspaceWriter({ revision: 0, document: null }, doc('new'), async () => { calls++; return { revision: 1 }; }, () => {});
  await writer.flush(); assert.equal(calls, 1); assert(!writer.dirty);
  writer.update(doc('x'.repeat(768 * 1024))); await writer.flush();
  assert.equal(calls, 1); assert.match(writer.error.message, /768 KB/); assert(writer.dirty);
});

test('recovery appends new IDs without overwriting saved SQL or database context', () => {
  const original = doc('server'), recovered = doc('local');
  const merged = mergeWorkspace(original, recovered, () => 'recovered-id');
  assert.equal(merged.tabs[0].sql, 'server'); assert.equal(merged.tabs[1].sql, 'local');
  assert.equal(merged.tabs[1].database, 'CaseDb'); assert.equal(merged.activeTabId, 'recovered-id');
  assert.equal(original.tabs.length, 1);
  assert.throws(() => mergeWorkspace(original, null, () => ''), /Invalid/);
  // Tabs the workspace already has are not added twice.
  assert.equal(mergeWorkspace(merged, recovered, () => 'again'), merged);
});
