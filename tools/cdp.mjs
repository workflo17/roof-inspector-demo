// Minimal Chrome DevTools Protocol client used by e2e.mjs and probe.mjs.
// launchChrome() starts a throwaway headless Chrome (fresh profile, so it never touches the
// real browser) and returns { send, evalJS, events, close }.
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function until(fn, ms = 15000, step = 150) {
  const t = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('timeout waiting for condition: ' + fn);
    await sleep(step);
  }
}

// A random port per run, so a Chrome from the previous run that is still shutting down can never answer.
export async function launchChrome(port = 9300 + Math.floor(Math.random() * 600)) {
  const profile = join(tmpdir(), 'roof-e2e-' + Date.now());
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const close = async () => {
    try { proc.kill(); } catch (e) { /* already gone */ }
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* profile may be locked, harmless */ }
  };
  process.on('exit', () => { try { proc.kill(); } catch (e) { /* already gone */ } });

  await until(async () => (await fetch(`http://127.0.0.1:${port}/json/version`)).ok);
  const tgt = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id) {
      const p = pending.get(d.id);
      pending.delete(d.id);
      d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result);
    } else events.push(d);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJS = async (expr, ms = 12000) => {
    // A promise that never settles (for example a service worker that never registers) must fail
    // the check, not hang the run, so every evaluation races a timeout.
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('evaluation timed out after ' + ms + ' ms')), ms)),
    ]);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evalJS, events, close };
}
