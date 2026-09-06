# Cloudflare Access implementation plan

## Goal and design

Protect `https://philippeho.dev/mp3maker` with an exact-email allowlist at
Cloudflare and cryptographic Access JWT validation at the Node origin.
Execute inline, without subagents. This document is committed before code changes.

The user authorized keeping the desktop worker, SSH tunnel and egress proxy running
while this work proceeds. Platform enablement is outside this change.

Use one account-level group, `Private Portal members`, referenced by the existing
Private Portal policy and the new MP3 Maker policy. Initially preserve the existing
single member; add friends only when exact addresses are supplied. Membership stays
in Cloudflare, not a duplicate origin email list. Hungry Dogs' own application auth
and existing Google/TOTP configuration remain intact.

The new self-hosted Access app covers `philippeho.dev/mp3maker` and its descendants.
Use the existing Google provider and independent TOTP settings, a 24-hour app
session, HttpOnly/binding cookies, and a path-scoped cookie. No bypass policy or
DNS changes. Other apex paths remain public.

The public Express listener verifies `Cf-Access-Jwt-Assertion` before parsing bodies
or serving any application route, asset, SSE stream or download. Use `jose` with a
cached remote JWKS at `https://philho.cloudflareaccess.com/cdn-cgi/access/certs`.
Require RS256, the exact issuer and app audience, expiration, issued-at, a nonempty
subject/email, and `type=app`. Invalid tokens and JWKS failures return a generic
403 without logging tokens or identity. Browser cookies and spoofed identity headers
are not substitutes for the signed assertion.

`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` enable verification together. Partial or invalid
configuration fails startup. Production requires both; local development can omit
both. Validate configuration before opening the SQLite store.

Only the exact GET/HEAD health endpoint may respond without a JWT when the actual
socket peer is loopback. Forwarded headers cannot authorize this exception.
The separate worker listener keeps its existing default-deny bearer authentication.

## Constraints

- Node 24 CommonJS, Express 5.2.1; add pinned `jose` for JWT/JWKS handling.
- Preserve job credentials, hashed IPs, no query logging, worker assignments and tokens.
- Preserve RAW Compose processing and worker's sole internal `media` network.
- No changes to enabled platforms, DNS, Tailscale or desktop startup.
- Existing PRs #3 and #4 are merged; public conversion already confirmed.
- Commit plan first; append evidence to `progress.md`; open PR and verify CI.

## Tasks and verification

### 1. Origin access gate

Files: `lib/access.js`, `server.js`, `tests/access.test.js`, `package.json`,
`package-lock.json`.

- [ ] Add integration tests against real HTTP listeners and locally signed RSA JWTs.
  First assert an unauthenticated request to `/mp3maker/` returns 403; run it and
  observe the current app return 200 before implementing.
- [ ] Add `createAccess({teamDomain,audience,jwks,nodeEnv})`, returning an Express
  middleware or null for unconfigured development. `jwks` is a test-only injected
  key resolver; production always uses the configured team endpoint.
- [ ] Wire `options.access` or the two environment variables before store creation.
  Put the health handler before the gate and move JSON parsing behind it.
- [ ] Test valid identity, bad signature/algorithm, wrong audience/issuer, expired
  and future tokens, missing claims, malformed headers, key-service failure,
  HTML/assets/API/SSE/download/cancel protection, health and worker separation.
- [ ] Run `npm test` and Python unit tests. Review the diff inline.

### 2. Deployment contract and shared membership

Files: `compose.yaml`, `SETUP.md`, `docs/implementation/progress.md`.

- [ ] Require both Access environment variables on the web service in Compose.
  Keep all network membership and RAW Compose semantics intact.
- [ ] Document configuration, exact-email group management, revocation/session
  behavior and a fail-closed rollback (keep the gate or stop serving the app).
- [ ] Inspect the live Coolify app and preserve a local rollback copy of its raw
  Compose definition, without committing credentials.
- [ ] Create the shared group from the existing policy's exact email selector.
  Replace only that selector with the group's ID in Private Portal's reusable
  policy; preserve every other rule. Create MP3 Maker with one Allow policy
  referencing the same group. Read back and record IDs and nonsecret AUD.
- [ ] Push the implementation branch, open a PR to main, and wait for CI's Node and
  Python tests, three Docker builds and worker selftest.

### 3. Coordinated release and acceptance

- [ ] Set the app's Access environment variables and raw Compose web env entries.
  Deploy the reviewed commit manually; do not add a deployment webhook.
- [ ] Poll health/deployment and allow Traefik to converge. Recheck container network
  membership and the desktop worker's connection after replacing the web container.
- [ ] Verify the public edge requires Access at the bare path, trailing slash, assets
  and API; verify the portfolio remains public. Test the direct IP with correct
  Host/SNI: missing and forged assertions must return 403 for application routes.
- [ ] Confirm browser login with the owner when an interactive session is available;
  do not claim human login verified from HTTP redirects alone.
- [ ] Record any remaining manual acceptance explicitly in the ledger and PR.

## References

- [Origin JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Application token claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
- Hungry Dogs `codex/cloudflare-access-auth:server/access.js` (reuse verification
  pattern without its single-owner email restriction).
