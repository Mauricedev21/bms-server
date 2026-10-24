/**
 * PWA runtime verification: launches headless Chrome against the vite preview
 * server, runs the pwa-test.html harness, waits for real completion, and prints
 * the harness results + pass/fail assertions. Uses plain Node (global WebSocket)
 * — no dependencies.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:4173/pwa-test.html';
const PORT = 9333;
const PROFILE = path.join(process.env.TEMP || '/tmp', 'pwa-cdp-profile-' + Date.now());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(500);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await res.json();
      wsUrl = j.webSocketDebuggerUrl;
    } catch {
      /* chrome not up yet */
    }
  }
  if (!wsUrl) throw new Error('Chrome DevTools endpoint never came up');

  // Open the harness page via a target
  let target;
  for (let i = 0; i < 20 && !target; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' });
      if (res.ok) target = await res.json();
    } catch {
      /* retry */
    }
    if (!target) await sleep(500);
  }
  if (!target) throw new Error('Could not open test target');
  const pageWsUrl = target.webSocketDebuggerUrl;

  const ws = new WebSocket(pageWsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

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

  await send('Runtime.enable');
  await send('Page.enable');

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };

  // Wait for the harness to signal completion (last line marker).
  let text = null;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const t = await evalJs(
        "(document.getElementById('out')||{}).textContent || ''"
      );
      if (typeof t === 'string' && (t.includes('HARNESS-DONE') || t.includes('FATAL:'))) {
        text = t;
        break;
      }
    } catch {
      /* page may still be loading */
    }
    await sleep(500);
  }

  if (text === null) {
    text = (await evalJs("(document.getElementById('out')||{}).textContent || 'TIMEOUT-NO-OUTPUT'")) || 'TIMEOUT-NO-OUTPUT';
  }

  console.log(text);
  console.log('---');

  const get = (k) => {
    const r = new RegExp('^' + k.replace(/\./g, '\\.') + ': (.*)$', 'm').exec(text);
    return r ? r[1].trim() : null;
  };
  const checks = [
    ['manifest served 200', get('manifest.status') === '200'],
    ['manifest content-type json', /json/.test(get('manifest.contentType') || '')],
    ['manifest.name set', Boolean(get('manifest.name'))],
    ['display standalone', get('manifest.display') === 'standalone'],
    ['start_url /', get('manifest.startUrl') === '/'],
    ['scope /', get('manifest.scope') === '/'],
    ['has 192 icon', get('manifest.has192') === 'true'],
    ['has 512 icon', get('manifest.has512') === 'true'],
    ['has maskable icon', get('manifest.hasMaskable') === 'true'],
    ['icon-192 served png', /^200 image\/png/.test(get('icon.icon-192.png') || '')],
    ['icon-512 served png', /^200 image\/png/.test(get('icon.icon-512.png') || '')],
    ['maskable served png', /^200 image\/png/.test(get('icon.maskable-512.png') || '')],
    ['service worker registered', get('sw.registered') === 'true'],
    ['service worker activated', get('sw.activated') === 'true'],
    ['service worker controls page', (get('sw.controller') || '').includes('/sw.js')],
    ['API response NOT cached', get('api.cached') === 'false'],
    ['app shell precached', get('shell.precached') !== 'MISSING' && Boolean(get('shell.precached'))],
    ['hashed asset cache created', get('assetCache.exists') === 'true'],
    ['index.html links manifest', get('index.linkManifest') === 'true'],
    ['index.html has theme-color', get('index.hasThemeColor') === 'true'],
    ['page links manifest', get('index.linkManifest') === 'true'],
  ];
  console.log('');
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
    if (!ok) failed++;
  }
  console.log('');
  console.log(failed === 0 ? 'ALL CHECKS PASSED' : failed + ' CHECK(S) FAILED');

  ws.close();
  chrome.kill();
  // clean profile
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CDP harness error:', e.message);
  try {
    process.kill(0, 0);
  } catch {
    /* ignore */
  }
  process.exit(2);
});
