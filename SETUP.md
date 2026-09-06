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
