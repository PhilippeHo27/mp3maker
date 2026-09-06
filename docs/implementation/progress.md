# Reliable conversion execution ledger
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
