import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function configuration(env = process.env) {
  const port = Number(env.ZHIXI_DEBUG_PORT || 19222);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ZHIXI_DEBUG_PORT 必须为 1024–65535 的整数。');
  return {
    port,
    autoLaunch: env.ZHIXI_AUTO_LAUNCH !== '0',
    executable: env.ZHIXI_EXE || 'C:\\Program Files\\ZhiXi\\ZXMind\\zhiximind-desktop.exe',
    stateDir: path.resolve(env.ZHIXI_MCP_STATE_DIR || path.join(projectDir, '.state')),
  };
}
