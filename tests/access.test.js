const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApps } = require('../server');
const { generateKeyPairSync, sign } = require('node:crypto');
const { createLocalJWKSet } = require('jose');
const teamDomain = 'philho.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = createLocalJWKSet({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256' }] });
function jwt(changes = {}, header = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: `https://${teamDomain}`, aud: [audience], exp: now + 300,
    iat: now, sub: 'person-id', email: 'friend@example.com', type: 'app', ...changes };
  const input = [ { alg: 'RS256', kid: 'test', ...header }, payload ]
    .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

async function setup(t, access = { teamDomain, audience, jwks }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp3-access-'));
  const service = createApps({ dataDir: dir, basePath: '/mp3maker', access,
    workerTokens: { one: 'w'.repeat(40) }, workerAssignments: { one: ['youtube'] } });
  const pub = service.publicApp.listen(0, '127.0.0.1');
  const internal = service.internalApp.listen(0, '127.0.0.1');
  await Promise.all([pub, internal].map(s => new Promise(resolve => s.once('listening', resolve))));
  t.after(async () => {
    service.close();
    await Promise.all([pub, internal].map(s => new Promise(resolve => s.close(resolve))));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { url: `http://127.0.0.1:${pub.address().port}/mp3maker`,
    internal: `http://127.0.0.1:${internal.address().port}` };
}

test('configured Access rejects unauthenticated HTML at the origin', async t => {
  const s = await setup(t);
  const response = await fetch(`${s.url}/`);
  assert.equal(response.status, 403);
});

test('valid signed app identity reaches assets and API; job ownership remains required', async t => {
  const s = await setup(t);
  const headers = { 'Cf-Access-Jwt-Assertion': jwt() };
  for (const route of ['/', '/styles.css', '/api/platforms']) {
    const r = await fetch(s.url + route, { headers });
    assert.equal(r.status, 200, route); await r.arrayBuffer();
  }
  assert.equal((await fetch(s.url + '/api/jobs/missing/file?token=fake', { headers })).status, 404);
});

test('all application routes reject missing assertions and spoofed identity headers', async t => {
  const s = await setup(t);
  for (const [method, route] of [['GET', ''], ['GET', '/'], ['GET', '/styles.css'],
    ['GET', '/api/platforms'], ['POST', '/api/jobs'], ['GET', '/api/jobs/abc'],
    ['GET', '/api/jobs/abc/events?token=fake'], ['GET', '/api/jobs/abc/file?token=fake'],
    ['POST', '/api/jobs/abc/cancel'], ['OPTIONS', '/api/jobs']]) {
    const r = await fetch(s.url + route, { method, headers: {
      'Cf-Access-Authenticated-User-Email': 'philippeho27@gmail.com',
      'X-Forwarded-For': '127.0.0.1', Cookie: `CF_Authorization=${jwt()}`,
      Authorization: 'Bearer fake', 'Content-Type': 'application/json',
    }, ...(method === 'POST' ? { body: '{invalid json' } : {}) });
    assert.equal(r.status, 403, `${method} ${route}`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await r.json(), { error: 'Access authentication required.' });
  }
});

test('invalid signed claims, signatures and algorithms fail closed', async t => {
  const s = await setup(t);
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const bad = { malformed: 'not-a-jwt', empty: '',
    expired: jwt({ exp: 1 }), future: jwt({ nbf: Math.floor(Date.now() / 1000) + 3600 }),
    issuer: jwt({ iss: 'https://attacker.cloudflareaccess.com' }), audience: jwt({ aud: ['b'.repeat(64)] }),
    noExpiry: jwt({ exp: undefined }), noIssuedAt: jwt({ iat: undefined }),
    noSubject: jwt({ sub: undefined }), emptySubject: jwt({ sub: '' }),
    noEmail: jwt({ email: undefined }), badEmail: jwt({ email: '' }),
    noType: jwt({ type: undefined }), orgToken: jwt({ type: 'org' }),
    badSignature: jwt({}, {}, otherKey), noAlgorithm: jwt({}, { alg: 'none' }),
    wrongAlgorithm: jwt({}, { alg: 'HS256' }), unknownKey: jwt({}, { kid: 'unknown' }) };
  for (const [name, token] of Object.entries(bad)) {
    const r = await fetch(s.url + '/api/platforms', { headers: { 'Cf-Access-Jwt-Assertion': token } });
    assert.equal(r.status, 403, name); await r.arrayBuffer();
  }
});

test('JWKS outages deny requests without exposing error details', async t => {
  const s = await setup(t, { teamDomain, audience, jwks: async () => { throw new Error('private network detail'); } });
  const r = await fetch(s.url + '/', { headers: { 'Cf-Access-Jwt-Assertion': jwt() } });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: 'Access authentication required.' });
});

test('local health and authenticated worker requests work without Access; public worker requests do not', async t => {
  const s = await setup(t);
  assert.equal((await fetch(s.url + '/health')).status, 200);
  assert.equal((await fetch(s.url + '/health', { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(s.url + '/health/')).status, 403);
  assert.equal((await fetch(s.url + '/health', { method: 'POST' })).status, 403);
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'w'.repeat(40)}` },
    body: JSON.stringify({ workerId: 'one', platforms: ['youtube'] }) };
  assert.equal((await fetch(s.internal + '/internal/heartbeat', options)).status, 200);
  assert.equal((await fetch(s.internal + '/internal/heartbeat', { ...options, headers: { 'Content-Type': 'application/json' } })).status, 403);
  assert.equal((await fetch(s.url + '/internal/heartbeat', options)).status, 403);
});

test('production and partial Access configuration cannot start unprotected', () => {
  const { createAccess } = require('../lib/access');
  assert.equal(createAccess({ nodeEnv: 'development' }), null);
  for (const config of [{ nodeEnv: 'production' }, { teamDomain }, { audience },
    { teamDomain: 'https://philho.cloudflareaccess.com', audience },
    { teamDomain: 'attacker.test', audience }, { teamDomain, audience: 'invalid' }]) {
    assert.throws(() => createAccess(config), /ACCESS_/);
  }
});
