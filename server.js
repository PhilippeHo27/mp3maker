const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { Store, ACTIVE, TERMINAL, MESSAGES, hash, random } = require('./lib/store');
const { canonicalize } = require('./lib/url');
const PLATFORMS = ['youtube', 'soundcloud', 'bandcamp'];
const MAX_BYTES = 150 * 1024 * 1024;
const safeTitle = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200) : '';

function createApps(options = {}) {
  const now = options.now || Date.now;
  const base = options.basePath ?? process.env.BASE_PATH ?? '';
  if (base && !/^\/[a-zA-Z0-9/_-]+$/.test(base)) throw new Error('Invalid BASE_PATH');
  const enabled = options.enabledPlatforms || (process.env.ENABLED_PLATFORMS || '').split(',').filter(Boolean);
  const tokens = options.workerTokens || JSON.parse(process.env.WORKER_TOKENS || '{}');
  const assignments = options.workerAssignments || JSON.parse(process.env.WORKER_ASSIGNMENTS || '{}');
  for (const [id, token] of Object.entries(tokens)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof token !== 'string' || token.length < 32) throw new Error('Invalid worker configuration');
  }
  const store = new Store({ dataDir: options.dataDir || process.env.DATA_DIR || path.join(__dirname, 'runtime'), now });
  const publicApp = express(), internalApp = express();
  const workers = new Map(), streams = new Map(), uploads = new Map();
  let closed = false;
  publicApp.disable('x-powered-by'); internalApp.disable('x-powered-by');
  const trust = options.trustProxy ?? process.env.TRUST_PROXY;
  publicApp.set('trust proxy', trust ? String(trust).split(',').map(s => s.trim()) : false);
  publicApp.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    next();
  });
  publicApp.use(express.json({ limit: '4kb' }));
  function status(platform) {
    const online = [...workers.values()].some(w => now() - w.seen < 35000 && w.platforms.includes(platform));
    if (!enabled.includes(platform)) return { available: false, reason: 'Not yet available' };
    if (store.blocked(platform)) return { available: false, reason: 'Source temporarily blocking requests' };
    return { available: online, reason: online ? null : 'Conversion worker offline' };
  }
  function notify(j) {
    for (const res of streams.get(j.id) || []) {
      res.write(`data: ${JSON.stringify(store.public(j))}\n\n`);
      if (TERMINAL.includes(j.state) || j.state === 'expired') res.end();
    }
  }
  function finish(j, state, code) {
    store.finish(j, state, code); notify(j); return j;
  }
  function sweep() {
    if (closed) return;
    for (const j of store.all()) {
      if (j.state === 'queued' && j.expiresAt <= now()) finish(j, 'failed', 'queue_expired');
      else if (ACTIVE.includes(j.state)) {
        if (now() - j.startedAt >= 600000) finish(j, 'failed', 'timeout');
        else if (!workers.has(j.workerId) || now() - workers.get(j.workerId).seen >= 35000) finish(j, 'failed', 'worker_lost');
      }
    }
    store.prune();
  }
  function owner(req, res, next) {
    const j = store.get(req.params.id);
    const bearer = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    const token = bearer || ((req.path.endsWith('/events') || req.path.endsWith('/file')) && req.query.token);
    if (!j || j.state === 'expired' || typeof token !== 'string' || token.length > 256 || hash(token) !== j.tokenHash) return res.status(404).json({ error: 'Conversion not found or expired.' });
    req.job = j; res.set('Cache-Control', 'no-store'); next();
  }
  publicApp.get(`${base}/health`, (req, res) => res.json({ status: 'ok' }));
  publicApp.get(`${base}/api/platforms`, (req, res) => {
    sweep(); res.set('Cache-Control', 'no-store').json({ platforms: Object.fromEntries(PLATFORMS.map(p => [p, status(p)])), limits: { durationSeconds: 900 } });
  });
  publicApp.post(`${base}/api/jobs`, (req, res) => {
    sweep(); let source;
    try { source = canonicalize(req.body?.url); } catch { return res.status(400).json({ code: 'unsupported_url', error: 'Use an individual HTTPS YouTube, SoundCloud or Bandcamp link.' }); }
    if (!status(source.platform).available) return res.status(503).json({ code: 'platform_unavailable', error: 'This platform is temporarily unavailable.' });
    const result = store.admit(req.ip, source.platform, source.url);
    if (result.error) return res.status(result.error).json({ code: result.code, error: result.message });
    res.status(202).json(result);
  });
  publicApp.get(`${base}/api/jobs/:id`, owner, (req, res) => { sweep(); res.json(store.public(store.get(req.job.id) || req.job)); });
  publicApp.post(`${base}/api/jobs/:id/cancel`, owner, (req, res) => {
    if (!TERMINAL.includes(req.job.state)) finish(req.job, 'cancelled');
    res.json(store.public(store.get(req.job.id)));
  });
  publicApp.get(`${base}/api/jobs/:id/events`, owner, (req, res) => {
    const clients = streams.get(req.job.id) || new Set();
    if (clients.size >= 2) return res.status(429).json({ error: 'Too many progress connections.' });
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(`data: ${JSON.stringify(store.public(req.job))}\n\n`);
    if (TERMINAL.includes(req.job.state)) return res.end();
    clients.add(res); streams.set(req.job.id, clients);
    const ping = setInterval(() => res.write(': heartbeat\n\n'), 15000); ping.unref();
    res.on('close', () => { clearInterval(ping); clients.delete(res); if (!clients.size) streams.delete(req.job.id); });
  });
  publicApp.get(`${base}/api/jobs/:id/file`, owner, (req, res) => {
    if (req.job.state !== 'ready') return res.status(409).json({ error: 'MP3 is not ready.' });
    const file = path.join(store.files, `${req.job.id}.mp3`);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'MP3 expired.' });
    res.download(file, (safeTitle(req.job.title).replace(/[<>:"/\\|?*]/g, '').slice(0, 120) || 'audio') + '.mp3');
  });
  publicApp.use(base || '/', express.static(path.join(__dirname, 'public')));

  // These routes are served ONLY by the internal listener, never by publicApp.
  internalApp.use(express.json({ limit: '8kb', type: 'application/json' }));
  internalApp.use((req, res, next) => {
    const id = req.body?.workerId || req.headers['x-worker-id'];
    const supplied = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (typeof id !== 'string' || !Object.hasOwn(tokens, id) || typeof supplied !== 'string' || hash(supplied) !== hash(tokens[id])) return res.status(403).json({ error: 'Worker authentication required.' });
    req.workerId = id; next();
  });
  internalApp.post('/internal/heartbeat', (req, res) => {
    const permitted = assignments[req.workerId] || [];
    const advertised = Array.isArray(req.body.platforms) ? req.body.platforms : [];
    workers.set(req.workerId, { seen: now(), platforms: advertised.filter(p => PLATFORMS.includes(p) && permitted.includes(p)), versions: req.body.versions || {} });
    res.json({ ok: true });
  });
  internalApp.post('/internal/claim', (req, res) => {
    sweep(); const w = workers.get(req.workerId), active = store.all().filter(j => ACTIVE.includes(j.state));
    if (!w || now() - w.seen >= 35000 || active.length >= 2 || active.some(j => j.workerId === req.workerId)) return res.json({ job: null });
    const job = store.all().find(j => j.state === 'queued' && w.platforms.includes(j.platform) && status(j.platform).available);
    if (!job) return res.json({ job: null });
    const leaseToken = random();
    Object.assign(job, { state: 'fetching', message: MESSAGES.fetching, startedAt: now(), expiresAt: now() + 600000, workerId: req.workerId, leaseHash: hash(leaseToken) });
    store.save(job); notify(job); res.json({ job: { id: job.id, url: job.url, platform: job.platform, leaseToken } });
  });
  function lease(req, res, next) {
    sweep(); const job = store.get(req.params.id), token = req.body?.leaseToken || req.headers['x-lease-token'];
    if (!job || job.workerId !== req.workerId || typeof token !== 'string' || hash(token) !== job.leaseHash || !ACTIVE.includes(job.state)) return res.status(409).json({ cancelled: true });
    req.job = job; next();
  }
  internalApp.post('/internal/jobs/:id/progress', lease, (req, res) => {
    const { state, percent, title } = req.body;
    if (state && !ACTIVE.includes(state)) return res.status(400).json({ error: 'Invalid progress state.' });
    const j = req.job;
    if (state && ACTIVE.indexOf(state) >= ACTIVE.indexOf(j.state)) j.state = state;
    if (Number.isFinite(percent)) j.percent = Math.max(j.percent, Math.min(99, Math.max(0, percent)));
    if (title) j.title = safeTitle(title);
    j.message = MESSAGES[j.state]; store.save(j); notify(j); res.json({ cancelled: false });
  });
  internalApp.post('/internal/jobs/:id/fail', lease, (req, res) => {
    const code = String(req.body.code || 'worker_error').slice(0, 64);
    if (code === 'platform_blocked') store.block(req.job.platform);
    finish(req.job, code === 'cancelled' ? 'cancelled' : 'failed', code); res.json({ ok: true });
  });
  internalApp.post('/internal/jobs/:id/result', lease, async (req, res) => {
    if (uploads.has(req.job.id)) return res.status(409).json({ error: 'Upload already in progress.' });
    if (!req.is('audio/mpeg') || Number(req.headers['content-length']) > MAX_BYTES) return res.status(413).json({ error: 'Invalid result.' });
    const id = req.job.id, temporary = path.join(store.files, `${id}.upload`), result = path.join(store.files, `${id}.mp3`);
    uploads.set(id, true); let bytes = 0, prefix = Buffer.alloc(0);
    const limiter = new Transform({ transform(chunk, encoding, done) {
      bytes += chunk.length; if (prefix.length < 3) prefix = Buffer.concat([prefix, chunk]).subarray(0, 3);
      const current = store.get(id);
      if (!current || current.leaseHash !== req.job.leaseHash || !ACTIVE.includes(current.state) || bytes > MAX_BYTES || now() - current.startedAt >= 600000) return done(new Error('Upload rejected'));
      done(null, chunk);
    } });
    const abort = new AbortController(); const timeout = setTimeout(() => abort.abort(), Math.max(1, 600000 - (now() - req.job.startedAt))); timeout.unref();
    try {
      await pipeline(req, limiter, fs.createWriteStream(temporary, { flags: 'wx' }), { signal: abort.signal });
      const valid = bytes >= 128 && (prefix.toString() === 'ID3' || (prefix[0] === 255 && (prefix[1] & 224) === 224));
      const j = store.get(id);
      if (!valid || !j || j.leaseHash !== req.job.leaseHash || !ACTIVE.includes(j.state)) throw new Error('Invalid audio');
      if (req.headers['x-track-title']) j.title = safeTitle(decodeURIComponent(req.headers['x-track-title']));
      fs.renameSync(temporary, result); finish(j, 'ready'); res.json({ ok: true });
    } catch {
      fs.rmSync(temporary, { force: true });
      const j = store.get(id); if (j && ACTIVE.includes(j.state)) finish(j, 'failed', bytes > MAX_BYTES ? 'size_limit' : 'invalid_audio');
      if (!res.destroyed) res.status(409).json({ error: 'Result rejected.' });
    } finally { clearTimeout(timeout); uploads.delete(id); }
  });
  internalApp.post('/internal/health', (req, res) => res.json({ worker: workers.get(req.workerId) || null, activeJobs: store.all().filter(j => ACTIVE.includes(j.state)).length }));
  for (const app of [publicApp, internalApp]) {
    app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
    app.use((err, req, res, next) => { if (!res.headersSent) res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: 'Request could not be processed.' }); });
  }
  const timer = setInterval(sweep, 5000); timer.unref();
  return { publicApp, internalApp, store, sweep, close() {
    if (closed) return; closed = true; clearInterval(timer);
    for (const clients of streams.values()) for (const res of clients) res.end();
    store.close();
  } };
}

if (require.main === module) {
  const service = createApps();
  const pub = service.publicApp.listen(Number(process.env.PORT || 3003), process.env.HOST || '0.0.0.0');
  const internal = service.internalApp.listen(Number(process.env.INTERNAL_PORT || 3004), process.env.INTERNAL_HOST || '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    pub.close(); internal.close(); service.close(); setTimeout(() => process.exit(0), 1000).unref();
  });
  console.log('MP3 Maker started; platform availability requires a verified, online worker.');
}
module.exports = { createApps };
