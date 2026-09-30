// Authored adapter for the installed Zhixi 3.8.0 renderer.
// Only fixed operations are exposed; no arbitrary evaluate/IPC tool.
export async function renderer(action, args = {}) {
  if (!window.__runtime?.invoke) throw new Error('这不是知犀桌面页面。');
  const ipc = (channel, value) => window.__runtime.invoke(channel, value);
  if (action === 'create_folder') {
    let response;
    try {
      response = await ipc('fs:create-folder', { title: args.title, pid: args.parentId ?? 0, password: '' });
    } catch (error) {
      throw new Error('创建文件夹结果未知，请先列出文件夹核实，避免重复创建：' + error.message);
    }
    if (response?.code !== 0) throw new Error('知犀拒绝创建云端文件夹：' + JSON.stringify(response));
    // The main-process wrapper returns the GUID and schedules directory sync.
    // Poll the listing for its numeric id; never repeat the creation request.
    let id = response.data?.id;
    let fileId = response.data?.fileId;
    if (!fileId && typeof response.data === 'string') fileId = response.data;
    for (let attempt = 0; !id && fileId && attempt < 10; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 500));
      const tree = await ipc('fs:query-file-tree', {
        pid: args.parentId ?? 0, password: '', orderBy: '', recursive: false, includeFiles: false,
      }).catch(() => null);
      const hit = tree?.code === 0 && Array.isArray(tree.data) ? tree.data.find(item => item.fileId === fileId) : undefined;
      id = hit?.id;
    }
    if (!fileId) throw new Error('知犀已返回成功但无法核实文件夹 ID，请先列出文件夹核实，不要重复创建。');
    if (!id) return { created: true, storage: 'cloud', title: args.title, parentId: args.parentId ?? 0,
      fileId, directoryReady: false, note: '文件夹已创建，目录同步尚未完成，请稍后列出目录获取数字 id。不要重复创建。' };
    return { created: true, storage: 'cloud', title: args.title, parentId: args.parentId ?? 0, id, fileId };
  }
  if (action === 'list_folders') {
    const response = await ipc('fs:query-file-tree', {
      pid: args.parentId ?? 0, password: '', orderBy: '', recursive: args.recursive ?? false, includeFiles: false,
    });
    if (response?.code !== 0) throw new Error('无法读取知犀云端文件夹：' + JSON.stringify(response));
    return { storage: 'cloud', parentId: args.parentId ?? 0, folders: response.data };
  }
  if (action === 'create') {
    const response = await ipc(args.storage === 'cloud' ? 'fs:create-file' : 'fs:create-local-file', {
      pid: 0,
      data: { type: 'template', contentUrl: args.contentUrl, trackFrom: 'MCP' },
    });
    if (response?.code !== 0 || !response?.data?.fileId) {
      throw new Error('知犀拒绝创建（可能需要登录、会员或处理弹窗）：' + JSON.stringify(response));
    }
    const fileId = response.data.fileId;
    // Zhixi 3.8.0's official create_cloud helper creates "未命名文件" first.
    // Rename through the same official file service before opening it.
    if (args.storage === 'cloud' && args.title) {
      const renamed = await ipc('fs:rename-file', { fileId, title: args.title, password: '' });
      if (renamed?.code !== 0) throw new Error('云端文件已创建，但重命名失败：' + JSON.stringify(renamed));
    }
    const opened = await ipc('wm:r-open-file', {
      iscloud: args.storage === 'cloud', fileid: fileId, title: args.title,
      focus: true, opentab: true, params: { id: '', readonly: false },
    });
    return { fileId, storage: args.storage, opened, created: true };
  }
  if (action === 'open') {
    const code = await ipc('wm:r-open-file', {
      iscloud: args.storage === 'cloud', fileid: args.file,
      title: '', focus: true, opentab: true, params: { id: '', readonly: false },
    });
    if (code !== 0) throw new Error('知犀打开失败，返回码：' + JSON.stringify(code));
    return { opened: true, code };
  }
  let require = window.__zhixiMcpRequire;
  if (!require) {
    const chunks = window.webpackChunkzhiximind_desktop;
    if (!Array.isArray(chunks) || chunks.push === Array.prototype.push) {
      if (action === 'probe') return { editor: false };
      throw new Error('当前页面尚未加载编辑器。');
    }
    chunks.push([['zhixi-mcp-' + Date.now()], {}, req => { require = req; }]);
    if (!require) throw new Error('无法取得编辑器模块，可能是版本不兼容。');
    window.__zhixiMcpRequire = require;
  }
  if (!require.m?.[88186]) {
    if (action === 'probe') return { editor: false };
    throw new Error('没有可用的编辑器模块；请先打开导图。');
  }
  const service = require(88186).l$_?.getCurrent?.();
  if (!service?.isLoadedData?.()) {
    if (action === 'probe') return { editor: false };
    throw new Error('导图尚未完成加载。');
  }
  const info = () => ({
    editor: true, fileId: service.getFileId(), title: service.getFileTitle(),
    storage: service.isLocalFile() ? 'local' : 'cloud',
    interactState: service.controller.getInteractState(),
    uiState: service.uiState?.value, modal: !!service.dialogState?.value,
    editState: service.fileEditState?.value,
  });
  if (action === 'probe') return info();
  const document = service.getMindDataJSon();
  if (action === 'read') return { ...info(), document };
  if (args.expectedFileId !== service.getFileId()) throw new Error('当前导图已切换，请重新读取后操作。');
  if (JSON.stringify(document) !== args.expectedDocument) throw new Error('导图已被更改，请重新读取后操作。');
  if (service.controller.getInteractState() !== 'normal' || service.dialogState?.value) {
    throw new Error('导图当前不可编辑（只读、输入中或有弹窗）。请在知犀中处理后再试。');
  }
  const find = (root, id) => {
    if (!root) return;
    if ((root.id ?? root.data?.id) === id) return root;
    const lists = Array.isArray(root.children) ? [root.children] : Object.values(root.children || {});
    for (const list of lists) for (const child of list || []) { const hit = find(child, id); if (hit) return hit; }
  };
  const findAny = (doc, id) => {
    for (const root of [doc.root, ...(doc.subTree || []), ...(doc.summaries || []), ...(doc.boundaries || [])]) {
      const hit = find(root, id); if (hit) return hit;
    }
  };
  const execute = async (name, params) => {
    if (!service.queryCommandValid(name)) throw new Error('当前导图不支持命令：' + name);
    await service.executeCommand(name, params);
  };
  if (action === 'save') {
    await execute('SaveCommand');
    return { ...info(), saveRequested: true, note: info().storage === 'cloud' ? '已请求知犀保存；云端同步由知犀官方客户端处理，请在知犀界面确认同步状态。' : '已请求知犀保存；首次保存本地导图可能弹出保存对话框，请在知犀中选择位置。' };
  }
  if (action === 'undo' || action === 'redo') {
    await execute(action === 'undo' ? 'UndoCommand' : 'RedoCommand');
    return { ...info(), document: service.getMindDataJSon() };
  }
  const node = findAny(document, args.nodeId);
  if (!node) throw new Error('节点不存在：' + args.nodeId);
  if (service.controller.getLockedNodes().has(args.nodeId)) throw new Error('该节点已锁定。');
  if (!service.mindMap.getNodeById(args.nodeId)) throw new Error('节点未显示，请先在知犀中展开该分支后重试。');
  if (action === 'set_text') {
    if (node.data.text === args.text) return { ...info(), changed: false, document };
    await execute('OutlineEditText', { id: args.nodeId, text: args.text });
    if (findAny(service.getMindDataJSon(), args.nodeId)?.data.text !== args.text) {
      throw new Error('编辑命令没有产生预期结果，请重新读取导图。');
    }
  } else if (action === 'set_note') {
    if ((node.data.note || '') === args.note) return { ...info(), changed: false, document };
    await execute('SetSelectedNodeNote', { nodeId: args.nodeId, note: args.note });
    if ((findAny(service.getMindDataJSon(), args.nodeId)?.data.note || '') !== args.note) throw new Error('备注修改未生效。');
  } else if (action === 'add_child') {
    service.selectNode(args.nodeId);
    if (!service.controller.getSelectedNodes().has(args.nodeId)) throw new Error('父节点无法选中。');
    await execute('AppendChildNode', args.text);
    const childrenOf = n => Array.isArray(n?.children) ? n.children : n?.children?.normal || [];
    const beforeIds = new Set(childrenOf(node).map(n => n.id ?? n.data?.id));
    const children = childrenOf(findAny(service.getMindDataJSon(), args.nodeId));
    if (!children.some(n => !beforeIds.has(n.id ?? n.data?.id) && n.data?.text === args.text)) {
      throw new Error('未检测到预期新增节点，请重新读取导图。');
    }
  } else throw new Error('未知操作：' + action);
  const after = service.getMindDataJSon();
  if (JSON.stringify(after) === JSON.stringify(document)) throw new Error('知犀未应用此次修改，请检查权限或应用状态。');
  return { ...info(), changed: true, document: after };
}

export const expression = (action, args) => '(' + renderer.toString() + ')(' + JSON.stringify(action) + ',' + JSON.stringify(args || {}) + ')';
