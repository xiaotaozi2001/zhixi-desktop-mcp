import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTemplate, flatten, revision, markdown } from '../src/model.js';
import { configuration } from '../src/config.js';
import { Cdp, isZhixiPage } from '../src/cdp.js';

test('out-of-order parents and duplicate labels retain distinct node identities', () => {
  const map = createTemplate('项目', [
    { key: 'b', parentKey: 'a', text: '任务' },
    { key: 'a', parentKey: 'root', text: '任务' },
  ]);
  const rows = flatten(map);
  assert.deepEqual(rows.map(n => n.depth), [0, 1, 2]);
  assert.equal(new Set(rows.map(n => n.id)).size, 3);
  assert.equal(rows[2].parentId, rows[1].id);
  assert.match(markdown(map), /项目\n  - 任务\n    - 任务/);
});

test('reject orphan nodes, cycles, reserved root, and duplicate keys', () => {
  assert.throws(() => createTemplate('x', [{ key: 'a', parentKey: 'missing', text: 'a' }]), /父节点不存在/);
  assert.throws(() => createTemplate('x', [{ key: 'a', parentKey: 'b', text: 'a' }, { key: 'b', parentKey: 'a', text: 'b' }]), /循环/);
  assert.throws(() => createTemplate('x', [{ key: 'root', text: 'x' }]), /重复/);
  assert.throws(() => createTemplate('x', [{ key: 'a', text: 'a' }, { key: 'a', text: 'b' }]), /重复/);
});

test('read newer schema with normal, summary, and free nodes', () => {
  const doc = { root: { id: 'r', data: { text: '中心' }, children: { normal: [{ id: 'n', data: { text: '分支', note: '备注' } }], summary: [{ id: 's', data: { text: '概要' } }] } }, subTree: [{ id: 'f', data: { text: '自由' } }] };
  assert.deepEqual(flatten(doc).map(n => [n.id, n.kind]), [['r', 'root'], ['n', 'normal'], ['s', 'summary'], ['f', 'subTree']]);
  assert.equal(flatten(doc)[1].note, '备注');
  assert.equal(revision(doc), revision(structuredClone(doc)));
  assert.notEqual(revision(doc), revision({ ...doc, title: 'changed' }));
});

test('debug connection and target selection are restricted', () => {
  assert.throws(() => new Cdp('ws://example.com/debug'), /本机/);
  assert.throws(() => new Cdp('wss://127.0.0.1/debug'), /本机/);
  assert.throws(() => configuration({ ZHIXI_DEBUG_PORT: 'NaN' }), /整数/);
  const executable = 'C:\\Program Files\\ZhiXi\\ZXMind\\zhiximind-desktop.exe';
  assert.equal(isZhixiPage({ url: 'file:///C:/Program%20Files/ZhiXi/ZXMind/resources/app.asar/dist/renderer/mind.html' }, executable), true);
  assert.equal(isZhixiPage({ url: 'file:///C:/OtherApp/resources/app.asar/dist/renderer/mind.html' }, executable), false);
  assert.equal(isZhixiPage({ url: 'https://example.com/app.asar/dist/renderer/mind.html' }, executable), false);
});
