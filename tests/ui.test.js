'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/downloader.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function app(handler, saved = null) {
  const calls = [], timers = new Map(), nodes = new Map(), links = [];
  let nextTimer = 0;
  class Element {
    constructor() { this.listeners = {}; this.dataset = {}; this.value = ''; this.hidden = true; this.textContent = ''; }
    set innerHTML(_) { throw new Error('Unsafe HTML insertion'); }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    replaceChildren(...children) { this.children = children; }
    appendChild(child) { links.push(child); }
    click() { this.clicked = true; }
    remove() {}
    focus() { this.focused = true; }
  }
  const window = new Element();
  window.BASE_PATH = '/mp3maker';
  const document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); },
    createElement: () => new Element(), body: new Element()
  };
  const storage = new Map(saved ? [['mp3maker.job/mp3maker', JSON.stringify(saved)]] : []);
  vm.runInNewContext(source, {
    document, window, AbortSignal, console,
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    fetch: async (path, options) => {
      calls.push({ path, ...options });
      if (path.endsWith('/platforms')) return { ok: true, json: async () => ({ platforms: { youtube: { available: false, reason: '<img onerror=attack()>' }, soundcloud: { available: true } } }) };
      const result = await handler(path, options);
      return { ok: !result.status || result.status < 400, status: result.status || 200, json: async () => result.body };
    }
  });
  return {
    nodes, calls, storage, timers, links, window,
    async submit() { document.getElementById('url').value = 'https://soundcloud.com/artist/track'; await document.getElementById('convertForm').listeners.submit({ preventDefault() {} }); },
    async click(id) { await document.getElementById(id).listeners.click(); },
    async tick() { const [id, timer] = [...timers][0] || []; assert.ok(timer, 'scheduled recovery poll'); timers.delete(id); await timer.fn(); }
  };
}

test('submits one job, stores its secret and renders a safe queued/ready track', async () => {
  let ready = false;
  const ui = app(async (path, opts) => path.endsWith('/jobs') ?
    { body: { id: 'job-1', token: 'secret' } } :
    { body: { state: ready ? 'ready' : 'queued', queuePosition: 2, title: '<script>attack()</script>', percent: 180 } });
  await ui.submit();
  assert.match(ui.nodes.get('statusText').textContent, /position 2/);
  assert.equal(ui.nodes.get('download').disabled, true);
  assert.equal(ui.nodes.get('trackTitle').textContent, '<script>attack()</script>');
  assert.equal(ui.nodes.get('progressBar').value, 100);
  assert.deepEqual(JSON.parse(ui.storage.get('mp3maker.job/mp3maker')), { id: 'job-1', token: 'secret' });
  assert.equal(ui.calls.find(c => c.path.endsWith('job-1')).headers.Authorization, 'Bearer secret');
  assert.ok(ui.calls.every(c => !c.path.includes('token=')));
  assert.match(ui.nodes.get('platforms').children[0].textContent, /<img/);
  ready = true;
  await ui.tick();
  assert.equal(ui.nodes.get('downloadReady').hidden, false);
  await ui.click('downloadReady');
  assert.equal(ui.links[0].href, '/mp3maker/api/jobs/job-1/file?token=secret');
  assert.equal(ui.links[0].referrerPolicy, 'no-referrer');
  assert.equal(ui.links[0].clicked, true);
  assert.match(ui.nodes.get('status').textContent, /Download started/);
});

test('refresh restores and a dropped connection recovers without creating or cancelling jobs', async () => {
  let disconnected = true;
  const ui = app(async () => {
    if (disconnected) throw new TypeError('network offline');
    return { body: { state: 'converting', percent: 70 } };
  }, { id: 'restored', token: 'saved-token' });
  await flush();
  assert.match(ui.nodes.get('status').textContent, /has not been cancelled/);
  assert.equal(ui.nodes.get('download').disabled, true);
  disconnected = false;
  await ui.tick();
  assert.equal(ui.nodes.get('progressBar').value, 70);
  assert.equal(ui.nodes.get('status').textContent, '');
  assert.ok(ui.calls.every(c => !c.method));
  ui.window.listeners.pagehide();
  assert.equal(ui.timers.size, 0);
  assert.ok(ui.storage.has('mp3maker.job/mp3maker'));
});

test('Cancel explicitly posts with bearer credentials and enables another conversion', async () => {
  let cancelled = false;
  const ui = app(async (path, options) => {
    if (path.endsWith('/cancel')) { cancelled = true; assert.equal(options.method, 'POST'); return { body: { ok: true } }; }
    return { body: { state: cancelled ? 'cancelled' : 'downloading', percent: 30 } };
  }, { id: 'job', token: 'secret' });
  await flush();
  await ui.click('cancel');
  assert.equal(ui.calls.filter(c => c.path.endsWith('/cancel')).length, 1);
  assert.equal(ui.nodes.get('download').disabled, false);
  assert.equal(ui.nodes.get('cancel').hidden, true);
  assert.match(ui.nodes.get('statusText').textContent, /cancelled/);
});

test('expired restored job clears storage and offers a fresh conversion', async () => {
  const ui = app(async () => ({ status: 404, body: { code: 'not_found' } }), { id: 'gone', token: 'old' });
  await flush();
  assert.equal(ui.storage.size, 0);
  assert.equal(ui.nodes.get('download').disabled, false);
  assert.equal(ui.nodes.get('downloadReady').hidden, true);
  assert.match(ui.nodes.get('status').textContent, /expired/);
});

test('typed server errors are clear and cannot insert HTML', async () => {
  const ui = app(async () => ({ status: 503, body: { code: 'platform_unavailable', error: '<img onerror=attack()>' } }));
  await ui.submit();
  assert.match(ui.nodes.get('status').textContent, /temporarily unavailable/);
  assert.equal(ui.nodes.get('download').disabled, false);
});

test('stale status response cannot resurrect job after page leaves', async () => {
  let resolve;
  const ui = app(() => new Promise(done => { resolve = done; }), { id: 'job', token: 'secret' });
  await flush();
  ui.window.listeners.pagehide();
  resolve({ body: { state: 'ready' } });
  await flush();
  assert.equal(ui.nodes.get('downloadReady').hidden, true);
  assert.equal(ui.timers.size, 0);
});
