import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { expression } from '../src/bridge.js';

test('cloud folders work on home page without an editor, including nested folders', async () => {
  const calls = [];
  const context = vm.createContext({ window: { __runtime: { invoke: async (channel, args) => {
    calls.push({ channel, ...args });
    if (channel === 'fs:query-file-tree') return { code: 0, data: [{ id: 42, type: 0, title: '学习资料', fileId: 'folder-guid' }] };
    return { code: 0, data: { id: 42, fileId: 'folder-guid' } };
  } } } });
  for (const parentId of [0, 123]) {
    const result = await vm.runInContext(expression('create_folder', { title: '学习资料', parentId }), context);
    assert.equal(result.id, 42);
    assert.equal(result.fileId, 'folder-guid');
    assert.equal(result.parentId, parentId);
    assert.equal(result.storage, 'cloud');
    assert.equal(calls.at(-1).channel, 'fs:create-folder');
    assert.equal(calls.at(-1).pid, parentId);
  }
  const legacy = vm.createContext({ window: { __runtime: { invoke: async (channel) => channel === 'fs:create-folder' ? { code: 0, data: 'legacy-guid' } : { code: 0, data: [{ id: 43, type: 0, title: '兼容目录', fileId: 'legacy-guid' }] } } } });
  const legacyResult = await vm.runInContext(expression('create_folder', { title: '兼容目录' }), legacy);
  assert.deepEqual({ id: legacyResult.id, fileId: legacyResult.fileId }, { id: 43, fileId: 'legacy-guid' });
  await vm.runInContext(expression('list_folders', { parentId: 123, recursive: true }), context);
  assert.equal(calls.at(-1).channel, 'fs:query-file-tree');
  assert.equal(calls.at(-1).includeFiles, false);
  assert.equal(calls.at(-1).recursive, true);
  assert.equal(calls.at(-1).pid, 123);
});

test('folder creation waits for directory sync without creating duplicates or matching names', async () => {
  let writes = 0;
  let reads = 0;
  const context = vm.createContext({ setTimeout: fn => fn(), window: { __runtime: { invoke: async channel => {
    if (channel === 'fs:create-folder') { writes++; return { code: 0, data: 'new-guid' }; }
    reads++;
    return { code: 0, data: [{ id: 1, title: '目录', fileId: 'old-guid' },
      ...(reads >= 3 ? [{ id: 2, title: '目录', fileId: 'new-guid' }] : [])] };
  } } } });
  const result = await vm.runInContext(expression('create_folder', { title: '目录' }), context);
  assert.equal(result.id, 2);
  assert.equal(writes, 1);
  assert.equal(reads, 3);
});

test('folder creation reports denied and uncertain outcomes without retrying', async () => {
  for (const response of [{ code: 401 }, { code: 0, data: {} }, new Error('断线')]) {
    let calls = 0;
    const context = vm.createContext({ window: { __runtime: { invoke: async () => {
      calls++;
      if (response instanceof Error) throw response;
      return response;
    } } } });
    await assert.rejects(vm.runInContext(expression('create_folder', { title: '目录' }), context), /拒绝|无法核实|结果未知/);
    assert.equal(calls, 1);
  }
});

function fixture(overrides = {}) {
  const document = { root: { id: 'r', data: { text: '中心' }, children: { normal: [{ id: 'n', data: { text: '分支' } }] } } };
  const calls = [];
  const service = {
    isLoadedData: () => true, getFileId: () => 'file-1', getFileTitle: () => '测试',
    isLocalFile: () => true, getMindDataJSon: () => structuredClone(document),
    uiState: { value: 'normal' }, dialogState: { value: '' }, fileEditState: { value: 'saved' },
    controller: { getInteractState: () => 'normal', getLockedNodes: () => new Set() },
    mindMap: { getNodeById: id => id === 'r' || id === 'n' },
    queryCommandValid: () => true,
    executeCommand: async (name, args) => {
      calls.push({ name, args });
      if (name === 'OutlineEditText') document.root.children.normal[0].data.text = args.text;
      if (name === 'SetSelectedNodeNote') document.root.children.normal[0].data.note = args.note;
    },
    ...overrides,
  };
  const req = () => ({ l$_: { getCurrent: () => service } });
  req.m = { 88186: true };
  const context = vm.createContext({ window: { __runtime: { invoke() {} }, __zhixiMcpRequire: req } });
  const args = () => ({ nodeId: 'n', text: '改后', expectedFileId: 'file-1', expectedDocument: JSON.stringify(document) });
  return { calls, service, document, args, run: (action, params) => vm.runInContext(expression(action, params), context) };
}

test('renderer applies text with native command and verifies postcondition', async () => {
  const f = fixture();
  const result = await f.run('set_text', f.args());
  assert.equal(result.changed, true);
  assert.equal(f.document.root.children.normal[0].data.text, '改后');
  assert.equal(f.calls[0].name, 'OutlineEditText');
});

test('renderer refuses stale documents and switched file before writes', async () => {
  const f = fixture();
  await assert.rejects(f.run('set_text', { ...f.args(), expectedDocument: '{}' }), /已被更改/);
  await assert.rejects(f.run('set_text', { ...f.args(), expectedFileId: 'other' }), /已切换/);
  assert.equal(f.calls.length, 0);
});

test('readonly, modal, and locked nodes cannot be mutated', async () => {
  for (const overrides of [
    { controller: { getInteractState: () => 'readonly' } },
    { dialogState: { value: 'purchase' } },
    { controller: { getInteractState: () => 'normal', getLockedNodes: () => new Set(['n']) } },
  ]) {
    const f = fixture(overrides);
    await assert.rejects(f.run('set_text', f.args()), /不可编辑|锁定/);
    assert.equal(f.calls.length, 0);
  }
});

test('silent native no-op is reported as failure', async () => {
  const f = fixture({ executeCommand: async () => {} });
  await assert.rejects(f.run('set_text', f.args()), /没有产生预期结果/);
});

test('save reports request only, not completed persistence', async () => {
  const f = fixture();
  const response = await f.run('save', f.args());
  assert.equal(response.saveRequested, true);
  assert.equal(response.saved, undefined);
  assert.equal(f.calls[0].name, 'SaveCommand');
});
