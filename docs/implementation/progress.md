# Reliable conversion execution ledger
## Access work started 2026-09-06
- User authorized keeping the temporary desktop worker, SSH tunnel and egress proxy running during Access work. No platform enablement changes authorized here.
- Branch `codex/cloudflare-access`; clean baseline passes 17 JavaScript tests. PRs #3 and #4 already merged.
- Cloudflare API access works through the installed plugin. Private Portal has one exact owner email and no account-level groups exist. Shared group starts with that member; friends' addresses have not been supplied.
- Design and execution steps: `docs/implementation/access-control-plan.md`. Work is inline, no subagents.
- Plan committed first as `d85a68e`. Test-first evidence: unauthenticated HTML returned 200 instead of expected 403 before the middleware existed. After implementation: 24 JavaScript tests and 14 Python tests pass; npm install audit reports zero known vulnerabilities.
- Created MP3 Maker Access app `6f04a1dc-6b16-4fdb-99da-706b800c5ad9`, AUD `e24a09269c6895e99ed260e86ab983b062dd21875e0b4c1304b5bcc92948a1e5`. It covers the existing apex path, uses Google + independent TOTP, 24h app sessions, and path-scoped HttpOnly/binding cookies. No DNS changes.
- Created `Private Portal members` group `f3fa84f5-6f0b-4421-8480-d67ea07b83d6` from the existing owner email. Both app policies reference it, verified by readback. Hungry Dogs' other settings remain unchanged. No friends' exact addresses supplied yet.
- Live Coolify inspection confirms RAW Compose on, auto-deploy off, Strip Prefix off, production platforms unchanged. Saved pre-change raw Compose locally under the desktop profile `.config/coolify/backups/mp3maker-access/compose-before.yaml`.
- Found a pre-existing temporary-rig discrepancy: desktop `mp3-prod-worker` is on `mp3-feasibility-edge` with `internal=false`, so the network does not enforce proxy-only egress. Requested a separate decision on repairing its attachment after Access; no desktop startup/Tailscale work begun.

Approved spec: user plan in conversation, 2026-09-04.
Tasks: (1) worker feasibility; (2) durable API; (3) public UI; (4) integration, security review, deployment.
Ruling: work in E:/WebDev/mp3maker-reliable on codex/reliable-conversion; isolated sibling avoids changing original checkout.
Ruling: worker feasibility runs independently before platform activation. API/UI can be implemented with fake worker while real extraction is tested.
Ruling: Hetzner currently has no Tailscale binary. Configure private connectivity if desktop fallback passes; never publish worker API.
## Shared contract
Node 24 CommonJS. Public BASE_PATH defaults empty, production /mp3maker. SQLite node:sqlite.
Public POST /api/jobs {url} -> 202 {id, token}; GET /api/jobs/:id, GET /api/jobs/:id/events, POST /api/jobs/:id/cancel, GET /api/jobs/:id/file require bearer token (events/file may use ?token=; no query logging).
GET /api/platforms -> {platforms:{youtube:{available,reason},soundcloud:{available,reason},bandcamp:{available,reason}},limits:{durationSeconds:900}}.
Job public shape {id,platform,state,percent,message,title,createdAt,expiresAt,queuePosition}; no internal paths, source URL, worker credentials.
Worker API separate listener, default port 3004, bearer WORKER_TOKEN (minimum 32 characters). Only private network routes. POST /internal/heartbeat {workerId,platforms,versions} -> {ok:true}; POST /internal/claim {workerId} -> {job:null|{id,url,platform,leaseToken}}. A worker owns one slot. Global max two active jobs.
POST /internal/jobs/:id/progress {workerId,leaseToken,state,percent,title,message} -> {cancelled:boolean}; POST /internal/jobs/:id/fail {workerId,leaseToken,code} -> {ok:true}; POST /internal/jobs/:id/result binary audio/mpeg with headers X-Worker-Id and X-Lease-Token, X-Track-Title URI-encoded. Result upload bounded 150 MiB and atomically published. Cancellation/lost lease rejects upload. Return {ok:true} only after stored ready.
Heartbeat every 10sec, stale after 35sec. Worker polls every 2sec. Progress every <=2sec for cancellation (even no subprocess output). Job deadline 600sec. Total per-job working files <=150 MiB. Disk tmpfs quota 192 MiB worker.
Server public and internal apps factory exported for tests, start only require.main. Credentials use random 32byte tokens; client tokens hashed. Terminal state TTL one hour. queued expiry 10min. Ready files retain one hour even after download.
Worker configuration: API_URL (private listener base without /mp3maker), WORKER_TOKEN, WORKER_ID, WORKER_PLATFORMS comma-separated, optional POT_URL. ENABLED_PLATFORMS on server defaults empty (activation only after verified). Worker permitted platforms enforced server-side through WORKER_ASSIGNMENTS JSON mapping id to list. Fixed worker identity per credential scope server map if needed.
Security: worker job URLs canonicalized; extractor allowlist; actual egress restriction via dedicated forward proxy that denies nonpublic addresses after DNS resolution and validates connect port. yt-dlp/ffmpeg subprocess traffic forced through proxy, container direct outbound blocked via isolated internal network. Worker control-plane network connectivity must remain available separately; no untrusted remote URL passed to ffmpeg directly (download locally first).

## Resumed 2026-09-06 (single agent; no delegation)
- Recovered implementation from this sibling worktree and the approved plan from the failed task.
- Baseline: 17 JavaScript tests and 14 Python tests pass; npm production audit reports zero vulnerabilities.
- Fixed CI dependency ordering: install requirements-worker.txt before running Python tests on a clean runner.
- Recovered 18 default feasibility reports from Hetzner; completed and saved 10 additional YouTube PO-token reports. Results and dependency versions are in docs/acceptance/README.md.
- Built the web Docker image on Hetzner and added a repeatable disposable integration check. Real Bandcamp conversion passed through job creation, worker claim, result upload, and authenticated file download at the production base path.
- Replaced obsolete PM2/host-pip README and setup instructions with the actual worker architecture, configuration, and release gates.
- Desktop blocker confirmed after normal Docker restart: firmware virtualization disabled, no hypervisor, WSL error HCS_E_HYPERV_NOT_INSTALLED. No BIOS changes, Windows feature changes, or reboot performed.
- Production release remains pending. Continue with desktop virtualization prerequisite, identical-image comparison, private connectivity, browser acceptance, and Coolify release gates. Do not enable YouTube based on the two successful server samples.

## Resumed 2026-09-06 (second agent; deployment unblock)
- Previous session stopped mid-release at a provider usage limit, not a code fault. Coolify had built all three images and created `web` and `egress`, but never started them; `worker` was never created.
- Root cause of the stalled worker: `compose.yaml` wrote the worker tmpfs as the YAML flow sequence `[/tmp:size=192m,mode=1777]`. A comma separates items in flow style, so this parsed as two mounts, `/tmp:size=192m` and `mode=1777`. Docker rejects the second: `invalid mount path: 'mode=1777' mount path must be absolute`. The worker container could not be created under any configuration.
- Fix: quoted the entry as a single mount, `tmpfs: ["/tmp:size=192m,mode=1777"]`. Verified on the Hetzner daemon that it mounts rw at 196608k and stays writable by uid 10001 under `read_only: true`.
- Verified unchanged: 17 JavaScript tests and 14 Python tests pass; yt-dlp 2026.08.19 matches the acceptance evidence.
- Confirmed Coolify raw Compose mode preserved worker isolation. The generated compose keeps `worker` on the internal `media` network only and adds no Coolify network to it.
- Release configuration confirmed Bandcamp-only: `ENABLED_PLATFORMS=bandcamp`, `HETZNER_PLATFORMS=bandcamp`, `WORKER_ASSIGNMENTS={"hetzner":["bandcamp"]}`, `TRUST_PROXY=10.0.1.20`.
- Still outstanding and deliberately not attempted: desktop firmware virtualization prerequisite, identical-image desktop comparison, private connectivity, and full browser acceptance for real conversions and failure states. YouTube and SoundCloud remain unenabled and have not passed the Hetzner gate.

## Resumed 2026-09-06 (desktop acceptance comparison)
- Cleared the desktop virtualization prerequisite: Intel VT-x was disabled in firmware on the ASUS TUF Z390-PLUS board. Enabling it restored the hypervisor and Docker Desktop. Recorded in the acceptance notes that `VirtualizationFirmwareEnabled` reads `False` once the hypervisor is running, so `HypervisorPresent` is the field to trust.
- Completed the identical-image desktop comparison. Same image tag, same container flags, same `--internal` network and egress proxy design, and sample URLs imported directly from `infra/acceptance.py`. Toolchain confirmed identical through `selftest`.
- Result: SoundCloud 0/4 to 4/4, YouTube 2/8 to 8/8 on eligible samples, Bandcamp 4/4 as an unchanged control. No `platform_blocked` occurred from the desktop; every Hetzner failure carried that code.
- Conclusion: the Hetzner failures are datacenter address reputation, not extraction logic or yt-dlp version. This matches the PO-token batch making no difference server-side. Reports saved in `docs/acceptance/desktop/`.
- Ruling unchanged for the server: do not enable YouTube or SoundCloud on the Hetzner worker. The evidence supports relocating the worker to a residential address, not enabling those platforms where they still fail.
- Next: worker startup on the desktop with the egress proxy retained, Tailscale private connectivity to the internal listener, and an access-control decision before any residential-address worker serves public traffic. The public site is currently unauthenticated, and sustained public volume is the most likely way to lose the address reputation the relocation depends on.

## Live conversion confirmed 2026-09-06
- A real YouTube conversion completed end to end through the public URL at `philippeho.dev/mp3maker`, served by the desktop worker over a temporary SSH tunnel to the internal listener. Confirmed by the user in the browser.
- This exercises the previously untested part of the path: Cloudflare, Traefik path routing at `BASE_PATH=/mp3maker`, SSE progress streaming through the proxy, job claim over the tunnel, result upload, and authenticated file download.
- Partially closes the browser acceptance gate. Real conversions are proven; failure states are still untested — cancellation, expiry, unsupported URL, and worker-offline behaviour have not been exercised in a browser.
- The configuration used was temporary and is not the intended release shape: `ENABLED_PLATFORMS` was widened to `youtube,soundcloud,bandcamp` and a second worker credential `desktop` was added. Access control must be settled before this shape is left running, since the public site is unauthenticated and the worker runs on a residential address.
