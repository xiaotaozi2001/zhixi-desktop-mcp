import path from 'node:path';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Cdp, targets, isZhixiPage } from './cdp.js';
import { expression } from './bridge.js';
import { connection } from './launcher.js';
import { createTemplate, flatten, revision, markdown } from './model.js';

export class ZhixiAdapter {
  constructor(config) { this.config = config; this.queue = Promise.resolve(); this.connection = connection(config); }
  exclusive(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async pages() {
    await this.connection.ensure();
    return (await targets(this.config.port)).filter(page => isZhixiPage(page, this.config.executable));
  }
  async call(page, action, args) {
    const client = new Cdp(page.webSocketDebuggerUrl);
    try { return await client.evaluate(expression(action, args)); } finally { client.close(); }
  }
  async list() {
    const list = [];
    for (const page of await this.pages()) {
      try { list.push({ targetId: page.id, ...(await this.call(page, 'probe')) }); }
      catch (error) { list.push({ targetId: page.id, editor: false, error: error.message }); }
    }
    return list;
  }
  async select(targetId) {
    const pages = await this.pages();
    if (targetId) {
      const found = pages.find(p => p.id === targetId);
      if (!found) throw new Error('页面已关闭或不存在，请重新列出导图。');
      return found;
    }
    const editors = [];
    for (const page of pages) if ((await this.call(page, 'probe')).editor) editors.push(page);
    if (editors.length !== 1) throw new Error('当前有 ' + editors.length + ' 个导图编辑器。请先打开导图；多个导图时必须指定 targetId。');
    return editors[0];
  }
  format(data, targetId, format = 'nodes') {
    const { document, ...meta } = data;
    return {
      targetId, ...meta, revision: revision(document),
      ...(format === 'json' ? { document } : format === 'markdown' ? { markdown: markdown(document) } : { nodes: flatten(document) }),
    };
  }
  async read({ targetId, format = 'nodes' } = {}) {
    const page = await this.select(targetId);
    return this.format(await this.call(page, 'read'), page.id, format);
  }
  async snapshot(data) {
    const folder = path.join(this.config.stateDir, 'snapshots');
    await mkdir(folder, { recursive: true });
    const file = path.join(folder, Date.now() + '-' + randomUUID() + '.json');
    await writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    return file;
  }
  async mutate(action, args) {
    return this.exclusive(async () => {
      const page = await this.select(args.targetId);
      const before = await this.call(page, 'read');
      if (before.interactState !== 'normal' || before.modal) throw new Error('导图当前不可编辑，请关闭弹窗、结束输入或检查编辑权限。');
      if (args.expectedRevision && args.expectedRevision !== revision(before.document)) throw new Error('revision 已过期，请重新读取导图。');
      const backup = await this.snapshot(before);
      try {
        const after = await this.call(page, action, { ...args, expectedFileId: before.fileId, expectedDocument: JSON.stringify(before.document) });
        return { backup, ...(after.document ? this.format(after, page.id) : after) };
      } catch (error) {
        throw new Error(error.message + '\n修改前快照：' + backup + '\n请读取导图确认实际结果后再决定是否重试。');
      }
    });
  }
  async create(args) {
    return this.exclusive(async () => {
      args = { ...args, storage: args.storage ?? 'cloud' };
      const pages = await this.pages();
      const page = pages.find(p => p.id === args.targetId) || (!args.targetId ? pages[0] : undefined);
      if (!page) throw new Error('没有可用的知犀窗口。');
      const template = createTemplate(args.title, args.nodes, args.layout);
      const folder = path.join(this.config.stateDir, 'templates');
      await mkdir(folder, { recursive: true });
      const file = path.join(folder, randomUUID() + '.json');
      await writeFile(file, JSON.stringify(template), { flag: 'wx' });
      const created = await this.call(page, 'create', { ...args, contentUrl: pathToFileURL(file).href });
      for (let count = 0; count < 25; count++) {
        await delay(200);
        let candidates;
        try { candidates = await this.pages(); } catch { break; }
        for (const candidate of candidates) {
          try {
            const data = await this.call(candidate, 'read');
            if (data.fileId === created.fileId) return { ...created, ...this.format(data, candidate.id) };
          } catch {}
        }
      }
      return { ...created, editorReady: false, note: '文件已创建，但编辑器尚未就绪；请检查登录/会员提示，再调用 zhixi_list_maps。不要重复创建。' };
    });
  }
  async folders(action, args = {}) {
    const run = async () => {
      const pages = await this.pages();
      if (!pages.length) throw new Error('没有可用的知犀窗口。');
      return this.call(pages[0], action, { ...args, parentId: args.parentId ?? 0 });
    };
    return action === 'create_folder' ? this.exclusive(run) : run();
  }
  async open(args) {
    return this.exclusive(async () => {
      const pages = await this.pages();
      if (!pages.length) throw new Error('没有可用的知犀窗口。');
      const file = args.file;
      if (args.storage === 'local') {
        if (!path.isAbsolute(file)) throw new Error('本地文件必须使用绝对路径。');
        if (path.extname(file).toLowerCase() !== '.zxm') throw new Error('当前仅支持打开 .zxm 本地文件。');
        await access(file);
      }
      return this.call(pages[0], 'open', { file, storage: args.storage });
    });
  }
}
