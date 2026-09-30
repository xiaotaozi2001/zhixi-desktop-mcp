import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionManager } from '../src/launcher.js';

const config = { executable: 'C:\\Program Files\\ZhiXi\\ZXMind\\zhiximind-desktop.exe', port: 19222 };
const page = { type: 'page', url: 'file:///C:/Program%20Files/ZhiXi/ZXMind/resources/app.asar/dist/renderer/home.html', webSocketDebuggerUrl: 'ws://127.0.0.1:19222/devtools/page/1' };
const off = async () => { throw new Error('ECONNREFUSED'); };
function fixture(overrides = {}) {
  let starts = 0;
  const manager = new ConnectionManager(config, {
    targets: off, ready: async () => true,
    processes: async () => ({ known: true, processes: [] }),
    start: async () => { starts++; }, delay: async () => {},
    ...overrides,
  });
  return { manager, starts: () => starts };
}

test('reuses a ready connection without launching or querying processes', async () => {
  const f = fixture({ targets: async () => [page], processes: async () => { throw new Error('must not query'); } });
  assert.equal((await f.manager.ensure()).alreadyRunning, true);
  assert.equal(f.starts(), 0);
});

test('first tool call launches once for concurrent callers and later reconnects', async () => {
  let online = false;
  const f = fixture({ targets: async () => online ? [page] : off(), delay: async () => { online = true; } });
  const results = await Promise.all([f.manager.ensure(), f.manager.ensure(), f.manager.ensure()]);
  assert.ok(results.every(r => r.connected));
  assert.equal(f.starts(), 1);
  assert.equal((await f.manager.ensure()).alreadyRunning, true);
});

test('existing ordinary process is never killed or relaunched; recovery needs no confirmation', async () => {
  const f = fixture({ processes: async () => ({ known: true, processes: [{ pid: 11 }] }) });
  await assert.rejects(f.manager.ensure(), { code: 'EXISTING_INSTANCE_NO_DEBUG' });
  await assert.rejects(f.manager.ensure(), { code: 'EXISTING_INSTANCE_NO_DEBUG' });
  assert.equal(f.starts(), 0);
  f.manager.deps.targets = async () => [page];
  assert.equal((await f.manager.ensure()).connected, true);
});

test('unknown process state and occupied port fail without launching', async () => {
  const unknown = fixture({ processes: async () => ({ known: false, processes: [] }) });
  await assert.rejects(unknown.manager.ensure(), { code: 'PROCESS_STATE_UNKNOWN' });
  assert.equal(unknown.starts(), 0);
  const busy = fixture({ targets: async () => [{ ...page, url: 'https://unrelated.example/' }] });
  await assert.rejects(busy.manager.ensure(), { code: 'PORT_IN_USE' });
  assert.equal(busy.starts(), 0);
});

test('failed startup is distinct from unsaved documents and repeated tools do not relaunch', async () => {
  const f = fixture();
  await assert.rejects(f.manager.ensure(), { code: 'START_TIMEOUT' });
  await assert.rejects(f.manager.ensure(), { code: 'START_TIMEOUT' });
  assert.equal(f.starts(), 1);
});

test('diagnostic status does not launch app; loading pages are waited for', async () => {
  const f = fixture();
  assert.equal((await f.manager.status()).state, 'stopped');
  assert.equal(f.starts(), 0);
  let reads = 0;
  f.manager.deps.targets = async () => ++reads < 3 ? [] : [page];
  assert.equal((await f.manager.ensure()).connected, true);
  assert.equal(f.starts(), 0);
});

test('profile access failure returns an actionable error instead of asking for saved documents', async () => {
  let closed = false;
  const f = fixture({start: async () => ({exited:true, code:0, stderr:'Lock file can not be created! Error code: 5', close:()=>{closed=true;}})});
  await assert.rejects(f.manager.ensure(), {code:'PROFILE_ACCESS_DENIED'});
  assert.equal(closed,true);
});
