import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ZhixiAdapter } from '../src/adapter.js';
import { revision } from '../src/model.js';

const initial = () => ({
  fileId: 'file-a', interactState: 'normal', modal: false,
  document: { root: { id: 'r', data: { text: '旧内容' } } },
});

test('folder creation uses home page and reports missing windows', async () => {
  const adapter = new ZhixiAdapter({});
  adapter.pages = async () => [{ id: 'home' }];
  adapter.select = async () => { throw new Error('must not require editor'); };
  adapter.call = async (page, action, args) => {
    assert.equal(page.id, 'home');
    assert.equal(action, 'create_folder');
    assert.equal(args.parentId, 0);
    return { id: 42 };
  };
  assert.equal((await adapter.folders('create_folder', { title: '目录' })).id, 42);
  adapter.pages = async () => [];
  await assert.rejects(adapter.folders('create_folder', { title: '目录' }), /没有可用/);
});

test('adapter rejects stale revision before snapshot or mutation', async () => {
  const adapter = new ZhixiAdapter({});
  let snapshots = 0;
  const actions = [];
  adapter.select = async () => ({ id: 'page-a' });
  adapter.call = async (_, action) => { actions.push(action); return initial(); };
  adapter.snapshot = async () => { snapshots++; };
  await assert.rejects(adapter.mutate('set_text', { expectedRevision: '0'.repeat(64) }), /过期/);
  assert.equal(snapshots, 0);
  assert.deepEqual(actions, ['read']);
});

test('adapter snapshots actual old document and passes expected file/content guards', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zhixi-mcp-test-'));
  const adapter = new ZhixiAdapter({ stateDir: dir });
  const before = initial();
  const after = initial();
  after.document.root.data.text = '新内容';
  adapter.select = async () => ({ id: 'page-a' });
  adapter.call = async (_, action, args) => {
    if (action === 'read') return before;
    assert.equal(args.expectedFileId, before.fileId);
    assert.equal(args.expectedDocument, JSON.stringify(before.document));
    return after;
  };
  const result = await adapter.mutate('set_text', { expectedRevision: revision(before.document), nodeId: 'r', text: '新内容' });
  const snapshot = JSON.parse(await readFile(result.backup, 'utf8'));
  assert.deepEqual(snapshot, before);
  assert.equal(result.nodes[0].text, '新内容');
});

test('write queue recovers after rejection and never overlaps writes', async () => {
  const adapter = new ZhixiAdapter({});
  const order = [];
  let release;
  const first = adapter.exclusive(async () => {
    order.push('first');
    await new Promise(resolve => { release = resolve; });
    throw new Error('expected failure');
  });
  const rejected = assert.rejects(first, /expected failure/);
  const second = adapter.exclusive(async () => { order.push('second'); return 'ok'; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['first']);
  release();
  await rejected;
  assert.equal(await second, 'ok');
  assert.deepEqual(order, ['first', 'second']);
});

test('create defaults to cloud when called without storage', async () => {
  const adapter = new ZhixiAdapter({ stateDir: await mkdtemp(path.join(os.tmpdir(), 'zhixi-mcp-cloud-')) });
  adapter.pages = async () => [{ id: 'page-a' }];
  const calls = [];
  adapter.call = async (_, action, args) => {
    calls.push({ action, args });
    if (action === 'create') return { fileId: 'cloud-file', created: true, storage: args.storage };
    return { fileId: 'cloud-file', document: { root: { id: 'r', data: { text: '云端' } } } };
  };
  const result = await adapter.create({ title: '云端默认', nodes: [] });
  assert.equal(calls[0].args.storage, 'cloud');
  assert.equal(result.storage, 'cloud');
});
