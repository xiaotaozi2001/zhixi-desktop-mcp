import { configuration } from './config.js';
import { launch } from './launcher.js';
import { targets, Cdp, isZhixiPage } from './cdp.js';

const config = configuration();
try {
  if (process.argv[2] === 'launch') console.log(JSON.stringify(await launch(config), null, 2));
  else {
    const pages = (await targets(config.port)).filter(page => isZhixiPage(page, config.executable));
    const output = [];
    for (const p of pages) {
      const client = new Cdp(p.webSocketDebuggerUrl);
      try {
        output.push({ id: p.id, title: p.title, url: p.url, runtime: await client.evaluate('({ hasRuntime: !!window.__runtime, webpack: Object.keys(window).filter(k=>k.startsWith("webpackChunk")), version: window.__runtime?.versions?.electron })') });
      } finally { client.close(); }
    }
    console.log(JSON.stringify({ port: config.port, pages: output }, null, 2));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
