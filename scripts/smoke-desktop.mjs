import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const binary = resolve(process.argv[2] || 'dists/local/rowset');
const directory = await mkdtemp(join(tmpdir(), 'rowset-desktop-smoke-'));
const env = { ...process.env, ROWSET_DESKTOP_DIR: directory, ROWSET_DESKTOP_NO_BROWSER: '1' };
let child = spawn(binary, ['desktop'], { env, stdio: 'pipe' });
let occupiedPort;
let output = '';
child.stderr.on('data', chunk => { output += chunk; });
try {
  let state;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Desktop exited: ${output}`);
    try { state = JSON.parse(await readFile(join(directory, 'instance.json'), 'utf8')); if ((await fetch(`http://127.0.0.1:${state.port}/readyz`)).ok) break; } catch { /* starting */ }
    await delay(100);
  }
  assert(state, 'desktop never became ready');
  const base = `http://127.0.0.1:${state.port}`;
  const open = await fetch(base + '/api/local/open', { method: 'POST', headers: { Authorization: `Bearer ${state.key}` } });
  assert.equal(open.status, 200);
  const ticket = await open.json();
  const login = () => fetch(base + '/api/auth/local', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(ticket) });
  const session = await login(); assert.equal(session.status, 200);
  assert.equal((await login()).status, 401, 'ticket replay accepted');
  const user = await session.json(); assert(user.accessToken);
  const workspace = { version: 1, activeTabId: 'smoke-tab', tabs: [{ id: 'smoke-tab', title: 'Port restart', sql: "SELECT 'workspace-survives-restart'", database: 'CaseDb' }] };
  const saveWorkspace = await fetch(base + '/api/workspace', { method: 'PUT', headers: { Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, document: workspace }) });
  assert.equal(saveWorkspace.status, 200, 'workspace save failed');
  const second = spawn(binary, ['desktop'], { env, stdio: 'pipe' });
  const secondStatus = await new Promise((resolve, reject) => { second.on('error', reject); second.on('exit', resolve); });
  assert.equal(secondStatus, 0, 'second launch failed');
  const sameState = JSON.parse(await readFile(join(directory, 'instance.json'), 'utf8'));
  assert.equal(sameState.port, state.port); assert.equal(sameState.key, state.key, 'second launch replaced the instance');
  const absent = await fetch(base + '/api/audit', { headers: { Authorization: `Bearer ${user.accessToken}` } }); assert.equal(absent.status, 404, 'server-only route answered');
  const stop = await fetch(base + '/api/local/stop?rollback=true', { method: 'POST', headers: { Authorization: `Bearer ${state.key}` } }); assert.equal(stop.status, 204);
  for (let attempt = 0; child.exitCode === null && attempt < 100; attempt++) await delay(100);
  assert.equal(child.exitCode, 0, 'desktop did not stop gracefully');
  // Force the next launcher onto a different port without touching user data.
  occupiedPort = createServer(socket => socket.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n'));
  await new Promise((resolve, reject) => { occupiedPort.once('error', reject); occupiedPort.listen(state.port, '127.0.0.1', resolve); });
  child = spawn(binary, ['desktop'], { env, stdio: 'pipe' });
  child.stderr.on('data', chunk => { output += chunk; });
  let restarted;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Restart exited: ${output}`);
    try {
      const candidate = JSON.parse(await readFile(join(directory, 'instance.json'), 'utf8'));
      if (candidate.port !== state.port && (await fetch(`http://127.0.0.1:${candidate.port}/readyz`)).ok) { restarted = candidate; break; }
    } catch { /* starting */ }
    await delay(100);
  }
  assert(restarted, 'port collision restart never became ready');
  const restartedBase = `http://127.0.0.1:${restarted.port}`;
  const nextTicket = await fetch(restartedBase + '/api/local/open', { method: 'POST', headers: { Authorization: `Bearer ${restarted.key}` } });
  const nextLogin = await fetch(restartedBase + '/api/auth/local', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: restartedBase }, body: JSON.stringify(await nextTicket.json()) });
  assert.equal(nextLogin.status, 200);
  const nextUser = await nextLogin.json();
  const restored = await fetch(restartedBase + '/api/workspace', { headers: { Authorization: `Bearer ${nextUser.accessToken}` } });
  assert.equal(restored.status, 200);
  const restoredWorkspace = await restored.json();
  assert.equal(restoredWorkspace.revision, 1); assert.deepEqual(restoredWorkspace.document, workspace);
  const staleSave = await fetch(restartedBase + '/api/workspace', { method: 'PUT', headers: { Authorization: `Bearer ${nextUser.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, document: workspace }) });
  assert.equal(staleSave.status, 409, 'stale revision overwrote saved workspace');
  const finalStop = await fetch(restartedBase + '/api/local/stop?rollback=true', { method: 'POST', headers: { Authorization: `Bearer ${restarted.key}` } }); assert.equal(finalStop.status, 204);
  for (let attempt = 0; child.exitCode === null && attempt < 100; attempt++) await delay(100);
  assert.equal(child.exitCode, 0, 'restarted desktop did not stop gracefully');
  console.log('PASS: automatic setup, one-use login, single instance, no server-only routes, shutdown, port collision restart, durable workspace and stale-write rejection');
  console.log(`Temporary test workspace retained: ${directory}`);
} finally {
  occupiedPort?.close();
  if (child.exitCode === null) child.kill('SIGTERM');
}
