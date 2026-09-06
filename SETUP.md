# Deployment setup

This branch is not yet approved by its acceptance checks for public release. Keep `ENABLED_PLATFORMS` empty until each platform passes real conversions on its assigned worker.

## Coolify target

Use the Git-backed Compose application from `PhilHo-Projects/mp3maker`, manual releases, and a unique read-only deploy key if private. The workflow validates/tests/builds; pushes must not deploy automatically.

Persist `/home/phil/app-data/mp3maker` at `/data` in the web container. Create it with owner UID/GID 1000 before startup; the web process runs as the unprivileged Node user. This holds both SQLite and finished MP3 files.

Configure these environment values privately in Coolify:

- `WORKER_TOKENS`: JSON object mapping worker IDs to independently generated random credentials, at least 32 characters each.
- `WORKER_ASSIGNMENTS`: JSON object mapping worker IDs to permitted platform arrays.
- `HETZNER_WORKER_TOKEN`: the credential corresponding to the `hetzner` worker ID.
- `HETZNER_PLATFORMS`: platforms the Hetzner worker advertises.
- `ENABLED_PLATFORMS`: comma-separated platforms that passed acceptance; empty by default.
- `TRUST_PROXY`: explicit trusted proxy addresses/subnets. Do not use arbitrary forwarded headers or trust every hop.

The public service is `web`, port 3003, with domain `https://philippeho.dev/mp3maker`. Disable Coolify Strip Prefix and verify generated Traefik routing preserves `/mp3maker`. Do not publish port 3004, the egress proxy, or a token-provider service. Keep the internal media network internal.

For Compose resources configure service domains using `docker_compose_domains`, not the application `domains` field.

## Desktop prerequisite

As checked on 2026-09-06, desktop firmware virtualization reports disabled and Docker cannot boot WSL2 (`HCS_E_HYPERV_NOT_INSTALLED`). Enable CPU virtualization in firmware and the Windows Virtual Machine Platform component as needed, then restart Windows and verify Docker Engine responds. This task has not changed firmware, Windows optional features, or sleep settings.

After Docker works, run the exact same worker image and sample matrix locally. Only then select a desktop fallback. Hetzner also needs private Tailscale connectivity before a desktop worker can pull jobs. This connectivity and desktop startup configuration are not implemented yet.

## Release checklist

1. Complete the desktop/Hetzner acceptance matrix; retain JSON reports and image versions.
2. Select only passing platform/worker assignments.
3. Complete browser checks: real download, refresh, cancellation, expiry, queue saturation, and worker offline.
4. Verify container network isolation, internal authentication, actual trusted proxy configuration, base-path routing, and SSE through Traefik.
5. Create the Coolify resource and credentials, preserve the previous image for rollback, and release manually.
6. Poll public routing after deployment; Traefik can take 30–60 seconds to recognize new containers.

No public deployment has been performed by the resumed task.

## Cloudflare Access (September 6 update)

The current release evidence and temporary desktop configuration are recorded in
`docs/implementation/progress.md`; the earlier prerequisite/release notes above
describe the original rollout, not the current live state.

Production requires `ACCESS_TEAM_DOMAIN=philho.cloudflareaccess.com` and
`ACCESS_AUD=e24a09269c6895e99ed260e86ab983b062dd21875e0b4c1304b5bcc92948a1e5`.
The AUD is not a secret. Missing or malformed production configuration stops startup.
For development, omit both values to run without Access. If either is set, both
must be valid. The web service verifies the signed assertion against the team's
JWKS and this app's audience for every application route, including static assets,
SSE and downloads. Existing per-job credentials are still required.

The exact local GET/HEAD `/mp3maker/health` probe remains available without Access
only over a loopback socket; forwarded IP headers cannot grant that exception.
Worker traffic continues through the private listener on 3004 using worker tokens.
Do not create a public bypass policy or an ingest-token exemption.

Cloudflare account `6cba1cadf64d5497e3abb2fefff8cf88`:

- MP3 Maker app: `6f04a1dc-6b16-4fdb-99da-706b800c5ad9`, path
  `philippeho.dev/mp3maker` and descendants; Google + independent TOTP.
- Shared group: **Private Portal members**, `f3fa84f5-6f0b-4421-8480-d67ea07b83d6`.
  Manage exact email members here. The MP3 Maker and Hungry Dogs Access policies
  reference this group, so a membership change affects both. Hungry Dogs retains
  its own application authentication. Do not duplicate member lists in policy/code.
- MP3 Maker app sessions last 24 hours; TOTP sessions use the existing 720-hour
  pattern. Removing an email prevents subsequent authorization; revoke that user's
  Access sessions too when immediate removal is needed. An already-issued JWT can
  remain valid at the origin until expiration, and an open stream is not revalidated.

Keep Coolify **RAW Compose** enabled and the worker attached only to the internal
`media` network. Update Access environment entries in both Coolify and its saved
raw Compose definition; do not let normal Compose processing add worker networks.
Releases remain manual. The temporary desktop SSH tunnel targets the web
container's internal IP; verify its destination after a redeploy.

For rollback, retain a build containing origin verification with valid Access
configuration, or stop serving the application while repairing it. Rolling back
to an image without the gate exposes the directly reachable origin even when
Cloudflare still shows a login page. No database/schema rollback is needed.
