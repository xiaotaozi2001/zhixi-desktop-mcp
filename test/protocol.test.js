import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('real stdio MCP handshake, tool schemas, argument validation, and disconnected errors', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.js', import.meta.url))],
    env: { ...process.env, ZHIXI_DEBUG_PORT: '65534', ZHIXI_AUTO_LAUNCH: '0', ZHIXI_EXE: 'C:\\MissingZhixiTest\\nonexistent-zhixi-test.exe' },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'zhixi-protocol-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 14);
    assert.ok(tools.some(t => t.name === 'zhixi_create_folder'));
    assert.ok(tools.some(t => t.name === 'zhixi_create_map'));
    assert.ok(tools.every(t => !/evaluate|shell|delete_file/.test(t.name)));
    const result = await client.callTool({ name: 'zhixi_list_maps', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /无法连接/);
    const invalid = await client.callTool({ name: 'zhixi_create_map', arguments: { title: '' } });
    assert.equal(invalid.isError, true);
    for (const args of [{ title: '   ' }, { title: '目录', parentId: -1 }, { title: '目录', parentId: 'guid' }, { title: '目录', parentId: 1.5 }]) {
      const invalidFolder = await client.callTool({ name: 'zhixi_create_folder', arguments: args });
      assert.equal(invalidFolder.isError, true);
      assert.doesNotMatch(invalidFolder.content[0].text, /无法连接/);
    }
  } finally { await client.close(); }
});
