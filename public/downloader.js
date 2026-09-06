(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const base = window.BASE_PATH || '';
  const storageKey = 'mp3maker.job' + base;
  const terminal = new Set(['ready', 'failed', 'cancelled', 'expired']);
  const names = { youtube: 'YouTube', soundcloud: 'SoundCloud', bandcamp: 'Bandcamp' };
  const messages = {
    duration_limit: 'This track exceeds the 15-minute limit. Choose a shorter track.',
    too_long: 'This track exceeds the 15-minute limit. Choose a shorter track.',
    unsupported_url: 'Use a single-track YouTube, SoundCloud or Bandcamp link.',
    platform_unavailable: 'This platform is temporarily unavailable. Try again later.',
    queue_full: 'The queue is full. Please try again in a few minutes.',
    rate_limited: 'Too many requests. You can start five conversions per hour. Please try again later.',
    worker_lost: 'The conversion worker disconnected. Please try converting again.',
    timeout: 'Conversion took too long. Please try again.',
    extraction_failed: 'The track could not be retrieved. Check that it is publicly available.',
    conversion_failed: 'Audio conversion failed. Please try again.'
  };
  let current = null;
  let state = null;
  let timer = null;
  let generation = 0;
  let submitting = false;
  let cancelling = false;

  function notice(message = '', type = 'loading') {
    $('status').textContent = message;
    $('status').className = message ? 'status ' + type + ' active' : 'status';
  }
  function save() {
    try {
      if (current) sessionStorage.setItem(storageKey, JSON.stringify(current));
      else sessionStorage.removeItem(storageKey);
    } catch {
      notice('Browser storage is unavailable. Keep this tab open to follow your conversion.');
    }
  }
  function errorMessage(data, fallback) {
    return messages[String(data.code || '').toLowerCase()] ||
      (typeof data.error === 'string' ? data.error : '') ||
      (typeof data.message === 'string' ? data.message : '') || fallback;
  }
  async function request(path, options = {}, credentials = null) {
    const response = await fetch(base + path, {
      ...options,
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(credentials ? { Authorization: 'Bearer ' + credentials.token } : {}),
        ...options.headers
      }
    });
    let data;
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) {
      const error = new Error(errorMessage(data, 'The server could not complete this request. Please try again.'));
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function controls() {
    const active = current && !terminal.has(state);
    $('download').disabled = submitting || Boolean(active);
    $('url').disabled = submitting || Boolean(active);
    $('cancel').hidden = !active;
    $('cancel').disabled = cancelling;
    $('cancel').textContent = cancelling ? 'Cancelling…' : 'Cancel conversion';
    $('downloadReady').hidden = state !== 'ready';
    $('retention').hidden = state !== 'ready';
  }
  function render(job) {
    state = job.state;
    $('progressContainer').hidden = false;
    $('trackTitle').textContent = typeof job.title === 'string' ? job.title : '';
    const percent = Math.max(0, Math.min(100, Number(job.percent) || 0));
    $('progressBar').value = state === 'ready' ? 100 : percent;
    $('progressPercent').textContent = state === 'queued' ? '' : Math.round($('progressBar').value) + '%';
    const labels = {
      queued: job.queuePosition ? 'Queued · position ' + job.queuePosition : 'Queued · waiting for a worker',
      fetching: 'Checking track…', downloading: 'Downloading audio…',
      converting: 'Converting to MP3…', ready: 'Your MP3 is ready.',
      cancelled: 'Conversion cancelled.', expired: 'This conversion has expired.'
    };
    $('statusText').textContent = labels[state] || job.message || 'Processing…';
    if (state === 'failed') {
      $('statusText').textContent = 'Conversion failed.';
      notice(errorMessage(job, 'Conversion failed. Please try again.'), 'error');
    } else if (state === 'cancelled') {
      notice('Conversion cancelled. You can convert another track.');
    }
    controls();
  }
  function expire() {
    generation++;
    clearTimeout(timer);
    current = null;
    state = 'expired';
    save();
    $('progressContainer').hidden = true;
    controls();
    notice('This conversion has expired or is no longer available. Paste the track link to convert it again.', 'error');
  }
  function schedule(delay = 2000) {
    clearTimeout(timer);
    timer = setTimeout(poll, delay);
  }
  async function poll() {
    if (!current) return;
    const run = generation;
    const credentials = current;
    try {
      const job = await request('/api/jobs/' + encodeURIComponent(credentials.id), {}, credentials);
      if (run !== generation) return;
      if (!job || typeof job.state !== 'string') throw new Error('Invalid status response');
      // Clear connection feedback when polling recovers.
      if ($('status').dataset.connection === 'true') { notice(); $('status').dataset.connection = ''; }
      render(job);
      if (state === 'ready') schedule(15000);
      else if (!terminal.has(state)) schedule();
    } catch (error) {
      if (run !== generation) return;
      if ([401, 403, 404, 410].includes(error.status)) { expire(); return; }
      $('status').dataset.connection = 'true';
      notice('Connection interrupted. Rechecking automatically; your conversion has not been cancelled.');
      schedule(5000);
    }
  }
  async function platforms() {
    try {
      const data = await request('/api/platforms');
      $('platforms').replaceChildren(...Object.entries(names).map(([key, name]) => {
        const entry = data.platforms?.[key];
        const item = document.createElement('li');
        item.textContent = name + (entry?.available ? ' · Available' : ' · ' + (entry?.reason || 'Temporarily unavailable'));
        if (entry?.available) item.className = 'available';
        return item;
      }));
    } catch {
      $('platforms').replaceChildren(...Object.values(names).map(name => {
        const item = document.createElement('li');
        item.textContent = name + ' · Availability could not be checked';
        return item;
      }));
    }
  }
  $('convertForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || (current && !terminal.has(state))) return;
    const url = $('url').value.trim();
    if (!url) { notice('Paste a track link first.', 'error'); $('url').focus(); return; }
    submitting = true;
    generation++;
    clearTimeout(timer);
    current = null;
    state = null;
    save();
    $('progressContainer').hidden = true;
    notice('Submitting track…');
    controls();
    try {
      const data = await request('/api/jobs', { method: 'POST', body: JSON.stringify({ url }) });
      if (typeof data.id !== 'string' || typeof data.token !== 'string') throw new Error('The server returned an invalid conversion response.');
      current = { id: data.id, token: data.token };
      state = 'queued';
      notice();
      save();
      render({ state: 'queued' });
      await poll();
    } catch (error) {
      notice(error.status ? error.message : 'Could not confirm submission. Check your connection before trying again.', 'error');
    } finally {
      submitting = false;
      controls();
      void platforms();
    }
  });
  $('cancel').addEventListener('click', async () => {
    if (!current || terminal.has(state) || cancelling) return;
    cancelling = true;
    controls();
    try {
      await request('/api/jobs/' + encodeURIComponent(current.id) + '/cancel', { method: 'POST' }, current);
      generation++;
      clearTimeout(timer);
      notice();
      await poll();
    } catch (error) {
      notice('Cancellation was not confirmed. ' + error.message + ' You can try Cancel again.', 'error');
    } finally {
      cancelling = false;
      controls();
    }
  });
  $('downloadReady').addEventListener('click', async () => {
    if (!current || state !== 'ready') return;
    const credentials = current;
    const run = generation;
    $('downloadReady').disabled = true;
    try {
      const job = await request('/api/jobs/' + encodeURIComponent(credentials.id), {}, credentials);
      if (run !== generation) return;
      if (job.state !== 'ready') { render(job); return; }
      const link = document.createElement('a');
      link.href = base + '/api/jobs/' + encodeURIComponent(credentials.id) + '/file?token=' + encodeURIComponent(credentials.token);
      link.download = '';
      link.referrerPolicy = 'no-referrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      notice('Download started. Check your browser for progress.', 'success');
    } catch (error) {
      if (run !== generation) return;
      if ([401, 403, 404, 410].includes(error.status)) expire();
      else notice('Could not start the download. Check your connection and try again.', 'error');
    } finally {
      $('downloadReady').disabled = false;
    }
  });
  window.addEventListener('pagehide', () => { generation++; clearTimeout(timer); });
  window.addEventListener('pageshow', event => { if (event.persisted && current) void poll(); });
  window.addEventListener('online', () => { if (current) { clearTimeout(timer); void poll(); } void platforms(); });
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (saved && typeof saved.id === 'string' && typeof saved.token === 'string' &&
        saved.id.length <= 128 && saved.token.length <= 256) current = { id: saved.id, token: saved.token };
  } catch { /* Malformed or unavailable storage must not prevent a new conversion. */ }
  controls();
  void platforms();
  if (current) { notice('Restoring your conversion…'); void poll(); }
})();
