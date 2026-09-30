import { randomUUID, createHash } from 'node:crypto';

// Input for Zhixi's importer, NOT the .zxm disk format.
export function createTemplate(title, nodes = [], template = 'default') {
  const root = { data: { id: randomUUID(), text: title }, children: [] };
  const byKey = new Map([['root', root]]);
  for (const item of nodes) {
    if (byKey.has(item.key)) throw new Error('重复的节点 key：' + item.key);
    byKey.set(item.key, { data: { id: randomUUID(), text: item.text }, children: [] });
  }
  const parents = new Map(nodes.map(n => [n.key, n.parentKey || 'root']));
  for (const item of nodes) {
    const parentKey = parents.get(item.key);
    if (!byKey.has(parentKey)) throw new Error('父节点不存在：' + parentKey);
    const seen = new Set([item.key]);
    let ancestor = parentKey;
    let depth = 0;
    while (ancestor !== 'root') {
      if (seen.has(ancestor)) throw new Error('节点之间存在循环引用。');
      if (++depth > 64) throw new Error('导图层级最多为 64。');
      seen.add(ancestor);
      ancestor = parents.get(ancestor);
      if (!ancestor) throw new Error('父节点链不完整。');
    }
    byKey.get(parentKey).children.push(byKey.get(item.key));
  }
  return {
    root, template, theme: 'ai-classical1', relativeLinks: [], generalizes: [],
    margin: [], background: '', zoom: 100, bgImage: null, subTree: [],
    nodeCount: nodes.length + 1,
    textCount: title.length + nodes.reduce((sum, n) => sum + n.text.length, 0),
    attachments: [], _view_mode: 'draw', isTemplate: true,
  };
}

export function flatten(document) {
  const output = [];
  const walk = (node, parentId, depth, kind) => {
    if (!node) return;
    const id = node.id ?? node.data?.id;
    output.push({ id, parentId, depth, kind, text: String(node.data?.text ?? ''), note: node.data?.note ?? null });
    if (Array.isArray(node.children)) node.children.forEach(child => walk(child, id, depth + 1, 'normal'));
    else for (const [type, children] of Object.entries(node.children || {})) {
      if (Array.isArray(children)) children.forEach(child => walk(child, id, depth + 1, type));
    }
  };
  walk(document.root, null, 0, 'root');
  for (const type of ['subTree', 'summaries', 'boundaries']) {
    for (const node of document[type] || []) walk(node, null, 0, type);
  }
  return output;
}

export function revision(document) {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex');
}

export function markdown(document) {
  return flatten(document).map(n => '  '.repeat(n.depth) + '- ' + n.text.replace(/\r?\n/g, ' / ')).join('\n');
}
