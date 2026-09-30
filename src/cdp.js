import WebSocket from 'ws';

export class Cdp {
  constructor(url, timeout = 15000) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('只允许连接本机调试接口。');
    this.url = url;
    this.timeout = timeout;
    this.nextId = 0;
    this.pending = new Map();
  }
  async connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const ws = this.ws = new WebSocket(this.url, { handshakeTimeout: this.timeout, maxPayload: 32 * 1024 * 1024 });
      ws.on('message', raw => {
        let reply;
        try { reply = JSON.parse(raw.toString()); } catch { return; }
        const entry = this.pending.get(reply.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(reply.id);
        reply.error ? entry.reject(new Error(reply.error.message)) : entry.resolve(reply.result);
      });
      ws.on('error', reject);
      ws.on('close', () => {
        this.connecting = undefined;
        for (const entry of this.pending.values()) {
          clearTimeout(entry.timer);
          entry.reject(new Error('知犀调试连接已断开，请重新列出导图。'));
        }
        this.pending.clear();
      });
      ws.once('open', resolve);
    });
    try { await this.connecting; } catch (error) { this.connecting = undefined; throw error; }
  }
  async send(method, params = {}) {
    await this.connect();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + ' 超时；若为写操作，请先读取文档确认结果，勿直接重试。'));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    return response.result?.value;
  }
  close() {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('连接已关闭。')); }
    this.pending.clear();
    this.ws?.close();
  }
}

export async function targets(port = 19222) {
  const response = await fetch('http://127.0.0.1:' + port + '/json/list', { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error('调试接口返回 HTTP ' + response.status);
  const result = await response.json();
  if (!Array.isArray(result)) throw new Error('调试接口返回了无效数据。');
  return result.filter(target => target.type === 'page' && target.webSocketDebuggerUrl);
}

export function isZhixiPage(target, executable) {
  try {
    const url = new URL(target.url);
    const pathname = decodeURIComponent(url.pathname).replaceAll('\\', '/').toLowerCase();
    if (url.protocol !== 'file:' || !/\/app\.asar\/dist\/renderer\//i.test(pathname)) return false;
    if (!executable) return /\/zhixi\/zxmind\//i.test(pathname);
    const folder = executable.replaceAll('\\', '/').split('/').slice(0, -1).join('/').toLowerCase();
    return pathname.startsWith('/' + folder + '/resources/app.asar/dist/renderer/');
  } catch { return false; }
}
