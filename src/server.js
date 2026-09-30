import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { configuration } from './config.js';
import { launch, connection } from './launcher.js';
import { ZhixiAdapter } from './adapter.js';

export function createServer(config = configuration(), adapter = new ZhixiAdapter(config)) {
  const server = new McpServer({ name: 'zhixi-desktop-mcp', version: '0.1.0' });
  const output = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
  const safe = handler => async args => {
    try { return output(await handler(args)); }
    catch (error) { return { ...output({ error: error.message, ...(error.code ? { code: error.code } : {}) }), isError: true }; }
  };
  const target = { targetId: z.string().optional().describe('zhixi_list_maps 返回的 targetId；多个导图时必填。') };
  const edit = { ...target, expectedRevision: z.string().length(64).optional().describe('读取时返回的 revision，用于拒绝过期修改。') };
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const writable = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
  const tool = (name, description, inputSchema, annotations, handler) =>
    server.registerTool(name, { description, inputSchema, annotations }, safe(handler));
  tool('zhixi_launch', '启动本机知犀并开启仅监听本机的调试端口。已有实例没有端口时不会强制退出。', {}, writable, () => adapter.exclusive(() => launch(config)));
  tool('zhixi_connection_status', '只读检查知犀连接和进程状态，不启动、不退出、不重启应用。其他业务工具会按需自动启动知犀。', {}, readOnly, () => connection(config).status());
  tool('zhixi_list_maps', '列出知犀当前打开的导图及其可编辑状态。', {}, readOnly, () => adapter.list());
  const folderParent = { parentId: z.number().int().safe().nonnegative().default(0).describe('父文件夹的数字 id；0 表示我的云文档根目录。不是 fileId。') };
  tool('zhixi_list_folders', '列出当前知犀账户的云端文件夹，取得创建子文件夹需要的数字 id。无需打开导图。', {
    ...folderParent, recursive: z.boolean().default(false),
  }, readOnly, args => adapter.folders('list_folders', args));
  tool('zhixi_create_folder', '在知犀官方云端创建文件夹（我的云文档中的目录）。返回数字 id 和 fileId；无需打开导图。', {
    ...folderParent, title: z.string().trim().min(1).max(1000),
  }, writable, args => adapter.folders('create_folder', args));
  tool('zhixi_read_map', '读取导图完整结构，返回节点 ID、文本、备注及 revision；也可返回 JSON 或 Markdown。', {
    ...target, format: z.enum(['nodes', 'json', 'markdown']).default('nodes'),
  }, readOnly, args => adapter.read(args));
  tool('zhixi_create_map', '通过知犀官方云端创建并打开导图。默认写入当前登录账户的云端，不创建本地临时导图；如确实需要本地文件，可显式传 storage=local。nodes 用 key/parentKey 建树，root 表示中心主题。', {
    ...target, title: z.string().min(1).max(1000),
    storage: z.enum(['local', 'cloud']).default('cloud'),
    layout: z.enum(['default', 'right', 'left']).default('default'),
    nodes: z.array(z.object({
      key: z.string().min(1).max(100),
      parentKey: z.string().min(1).max(100).default('root'),
      text: z.string().min(1).max(10000),
    })).max(1000).default([]),
  }, writable, args => adapter.create(args));
  tool('zhixi_open_map', '在知犀打开本地 .zxm（绝对路径）或指定云端 fileId。', {
    storage: z.enum(['local', 'cloud']).default('local'), file: z.string().min(1),
  }, writable, args => adapter.open(args));
  tool('zhixi_set_node_text', '修改已有节点文字，保留其他节点属性，生成修改前 JSON 快照。文字样式会转为纯文本。', {
    ...edit, nodeId: z.string().min(1), text: z.string().min(1).max(10000),
  }, { ...writable, destructiveHint: true }, args => adapter.mutate('set_text', args));
  tool('zhixi_add_child', '在指定父节点下新增子主题，返回更新后的完整节点列表。', {
    ...edit, nodeId: z.string().min(1).describe('父节点 ID'), text: z.string().min(1).max(10000),
  }, writable, args => adapter.mutate('add_child', args));
  tool('zhixi_set_note', '修改指定节点备注；空字符串清除备注。', {
    ...edit, nodeId: z.string().min(1), note: z.string().max(50000),
  }, { ...writable, destructiveHint: true }, args => adapter.mutate('set_note', args));
  tool('zhixi_save_map', '触发知犀原生保存流程。返回 saveRequested，不保证磁盘写入或云同步完成；如弹出保存对话框，由用户选择路径。', edit, writable, args => adapter.mutate('save', args));
  tool('zhixi_undo', '撤销当前导图最近一步修改（包括用户手动操作）。', edit, { ...writable, destructiveHint: true }, args => adapter.mutate('undo', args));
  tool('zhixi_redo', '重做当前导图最近一次撤销。', edit, { ...writable, destructiveHint: true }, args => adapter.mutate('redo', args));
  return server;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  createServer().connect(new StdioServerTransport()).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
