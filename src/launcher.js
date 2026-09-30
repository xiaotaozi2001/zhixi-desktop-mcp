import { access } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { targets, isZhixiPage, Cdp } from './cdp.js';

const exec = promisify(execFile);
export class ConnectionError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

// Avoid WMI/CIM permissions; never interpret an access failure as absence.
export async function processes(config) {
  if (process.platform !== 'win32') return { known: false, processes: [] };
  const name = path.win32.basename(config.executable, '.exe').replaceAll("'", "''");
  try {
    const script = "$ErrorActionPreference='Stop'; $items=@(Get-Process | Where-Object { $_.ProcessName -eq '" + name + "' } | ForEach-Object { $p=$null; try { $p=$_.Path } catch {}; @{pid=$_.Id; path=$p} }); ConvertTo-Json -InputObject $items -Compress";
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 5000 });
    const found = JSON.parse(stdout || '[]');
    const matching = found.filter(p => !p.path || p.path.toLowerCase() === config.executable.toLowerCase());
    return { known: !matching.some(p => !p.path), processes: matching };
  } catch (error) { return { known: false, processes: [], error: error.message }; }
}

async function ready(pages) {
  for (const page of pages) {
    const client = new Cdp(page.webSocketDebuggerUrl, 2500);
    try {
      if (await client.evaluate('document.readyState === "complete" && !!window.__runtime?.invoke && !!document.body?.children?.length')) return true;
    } catch {} finally { client.close(); }
  }
  return false;
}

async function start(config) {
  await access(config.executable);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const child = spawn(config.executable, ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + config.port], {
    detached: true, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, env, cwd: path.dirname(config.executable),
  });
  const outcome = { exited: false, code: null, stderr: '' };
  child.stderr.on('data', data => { outcome.stderr = (outcome.stderr + data.toString()).slice(-8192); });
  child.once('exit', code => { outcome.exited = true; outcome.code = code; });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  outcome.close = () => child.stderr.destroy();
  return outcome;
}

export class ConnectionManager {
  constructor(config, deps = {}) {
    this.config = config;
    this.deps = { targets, processes, ready, start, delay, now: Date.now, ...deps };
    this.pending = null;
    this.lastFailure = null;
  }
  async endpoint() {
    let pages;
    try { pages = await this.deps.targets(this.config.port); }
    catch (error) { return { available: false, error: error.message }; }
    const matching = pages.filter(p => isZhixiPage(p, this.config.executable));
    if (!matching.length && pages.length) throw new ConnectionError('PORT_IN_USE', '调试端口被其他应用占用，请修改 ZHIXI_DEBUG_PORT。');
    return { available: true, pages: matching, ready: matching.length > 0 && await this.deps.ready(matching) };
  }
  async status() {
    try {
      const endpoint = await this.endpoint();
      if (endpoint.ready) return { state: 'connected', connected: true, port: this.config.port, pages: endpoint.pages.length };
      const info = await this.deps.processes(this.config);
      return { state: endpoint.available ? 'starting' : info.processes.length ? 'running_without_connection' : info.known ? 'stopped' : 'unknown',
        connected: false, port: this.config.port, ...info };
    } catch (error) { return { state: error.code || 'unknown', connected: false, error: error.message }; }
  }
  async ensure() {
    if (this.pending) return this.pending;
    this.pending = this.connect().finally(() => { this.pending = null; });
    return this.pending;
  }
  async connect() {
    const endpoint = await this.endpoint();
    if (endpoint.ready) { this.lastFailure = null; return { connected: true, alreadyRunning: true, port: this.config.port }; }
    if (this.lastFailure && this.deps.now() - this.lastFailure.at < 10000) throw this.lastFailure.error;
    let startup;
    try {
      const info = await this.deps.processes(this.config);
      let started = false;
      if (!endpoint.available && !info.processes.length) {
        if (this.config.autoLaunch === false) throw new ConnectionError('AUTO_LAUNCH_DISABLED', '无法连接知犀，自动启动已关闭。');
        if (!info.known) throw new ConnectionError('PROCESS_STATE_UNKNOWN', '无法可靠检测知犀进程，未执行启动或重启。', info);
        try { startup = await this.deps.start(this.config); started = true; }
        catch (error) { throw new ConnectionError('START_FAILED', '知犀自动启动失败：' + error.message); }
      }
      // Wait for an already-starting instance without relaunching it.
      const attempts = started || endpoint.available ? 40 : 6;
      for (let i = 0; i < attempts; i++) {
        await this.deps.delay(500);
        const next = await this.endpoint();
        if (next.ready) return { connected: true, alreadyRunning: !started, port: this.config.port };
        if (startup?.exited && /Lock file can not be created|Crashpad.*(?:0x5|denied|拒绝访问)/i.test(startup.stderr)) {
          throw new ConnectionError('PROFILE_ACCESS_DENIED', '知犀无法写入用户数据目录或创建启动锁，因此已退出。请检查 MCP 运行账户和目录权限；这不是未保存文档问题，不需要反复手工重启知犀。');
        }
        if (startup?.exited && startup.code !== 0) throw new ConnectionError('PROCESS_EXITED', '知犀启动后退出，退出码：' + startup.code);
      }
      if (!started && info.processes.length && !endpoint.available) {
        throw new ConnectionError('EXISTING_INSTANCE_NO_DEBUG', '检测到知犀已运行，但未开放 MCP 连接端口。现有实例保持不变；配置启动入口后，在下次正常退出并重新打开知犀时生效。无需每次运行 BAT，也不要强制结束进程。', info);
      }
      throw new ConnectionError(started ? 'START_TIMEOUT' : 'PAGE_NOT_READY', started
        ? '已尝试自动启动知犀，但连接未就绪。可能是进程退出、桌面会话或权限问题；并未检测到需要用户处理的未保存文档。请查看 zhixi_connection_status。'
        : '知犀调试接口存在，但页面尚未就绪，请稍后重试。');
    } catch (error) { this.lastFailure = { at: this.deps.now(), error }; throw error; }
    finally { startup?.close?.(); }
  }
}

const managers = new WeakMap();
export function connection(config) {
  if (!managers.has(config)) managers.set(config, new ConnectionManager(config));
  return managers.get(config);
}
export const launch = config => connection(config).ensure();
