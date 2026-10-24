/**
 * Definitive PWA offline test:
 *  1. Load the real app (vite preview build) and let the SW install + cache it.
 *  2. Emulate NETWORK OFFLINE.
 *  3. Reload the page.
 *  4. Assert the app still renders (served from the SW app-shell cache).
 *
 * Also re-checks that hashed assets land in the asset cache (polls entries).
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:4173/';
const PORT = 9334;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'pwa-offline-profile-' + Date.now());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = spawn(
    CHROME,
    ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
     `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank'],
    { stdio: 'ignore', windowsHide: true }
  );

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(500);
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      wsUrl = j.webSocketDebuggerUrl;
    } catch { /* not up */ }
  }
  if (!wsUrl) throw new Error('DevTools endpoint never came up');

  let target = null;
  for (let i = 0; i < 20 && !target; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' });
      if (res.ok) target = await res.json();
    } catch { /* retry */ }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('Could not open target');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');

  const checks = [];
  const check = (name, ok) => checks.push([name, ok]);

  // 1. First load (online): app renders, SW installs, assets fetched normally.
  let rendered = false;
  for (let i = 0; i < 60 && !rendered; i++) {
    rendered = await evalJs("!!document.getElementById('root') && document.getElementById('root').children.length > 0")
      .catch(() => false);
    if (!rendered) await sleep(500);
  }
  check('initial online load renders app', rendered);

  // Wait for SW control.
  let controlled = false;
  for (let i = 0; i < 60 && !controlled; i++) {
    controlled = await evalJs("!!navigator.serviceWorker.controller").catch(() => false);
    if (!controlled) await sleep(500);
  }
  check('service worker controls page', controlled);

  // Give asset caching a moment, then confirm entries > 0.
  // NOTE: on the very first visit assets load BEFORE the SW takes control
  // (nothing to intercept yet), so the SW asset cache normally fills on the
  // NEXT navigation — we re-check after the offline reload below too.
  let assetEntries = 0;
  for (let i = 0; i < 6 && assetEntries === 0; i++) {
    assetEntries = await evalJs(`(async () => {
      const keys = await caches.keys();
      const k = keys.find(x => x.startsWith('bms-assets'));
      if (!k) return -1;
      return (await (await caches.open(k)).keys()).length;
    })()`).catch(() => 0);
    if (assetEntries <= 0) await sleep(500);
  }

  // 2. GO OFFLINE.
  await send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });

  // Confirm fetches really fail now.
  const fetchFails = await evalJs(
    "fetch('/index.html').then(() => 'unexpected-success').catch(() => 'blocked')"
  ).catch((e) => 'error:' + e.message);
  check('network is truly offline (' + fetchFails + ')', fetchFails === 'blocked');

  // 3. RELOAD while offline.
  await send('Page.reload', { ignoreCache: false });
  await sleep(1500);

  // 4. Assert the app renders again from cache.
  let offlineRendered = false;
  let title = '';
  for (let i = 0; i < 40 && !offlineRendered; i++) {
    try {
      const state = await evalJs(`({
        hasRoot: !!document.getElementById('root'),
        kids: (document.getElementById('root') || { children: [] }).children.length,
        title: document.title,
        text: (document.body.innerText || '').slice(0, 200),
      })`);
      title = state.title;
      offlineRendered = state.hasRoot && state.kids > 0;
      if (offlineRendered && state.text && state.text.trim().length > 0) break;
    } catch { /* navigating */ }
    await sleep(500);
  }
  check('OFFLINE reload renders app shell (title="' + title + '")', offlineRendered);

  // Bonus: navigation fallback served by SW (body text present means React mounted).
  const bodyText = await evalJs("(document.body.innerText || '').trim().length").catch(() => 0);
  check('React mounted content offline (chars=' + bodyText + ')', bodyText > 0);

  // After the offline reload, the SW-controlled page re-requested the hashed
  // JS/CSS through the fetch handler → those must now be in the asset cache.
  let postEntries = 0;
  for (let i = 0; i < 10 && postEntries === 0; i++) {
    postEntries = await evalJs(`(async () => {
      const keys = await caches.keys();
      const k = keys.find(x => x.startsWith('bms-assets'));
      if (!k) return -1;
      return (await (await caches.open(k)).keys()).length;
    })()`).catch(() => 0);
    if (postEntries <= 0) await sleep(500);
  }
  check('hashed JS/CSS in SW cache after offline reload (entries=' + postEntries + ')', postEntries > 0);

  console.log('');
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
    if (!ok) failed++;
  }
  console.log('');
  console.log(failed === 0 ? 'OFFLINE TEST: ALL PASSED' : failed + ' OFFLINE CHECK(S) FAILED');

  ws.close();
  chrome.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('offline harness error:', e.message); process.exit(2); });
