# MP3 Maker

A small public-link MP3 converter with an Express API, SQLite job queue, and an isolated Python/yt-dlp/FFmpeg worker. Tracks must be public, single-item, and at most 15 minutes. Output is 192 kbps MP3; transcoding does not improve the original audio quality.

## Current release status

Implementation is in progress, **not released**. Platforms default to unavailable until explicitly enabled and an assigned worker is online.

Hetzner acceptance: Bandcamp passed four conversions. YouTube passed only two of ten both with and without the automatic token provider. SoundCloud returned HTTP 403 for all four attempts. Desktop comparison is blocked by disabled firmware virtualization. See [acceptance evidence](docs/acceptance/README.md) and [execution ledger](docs/implementation/progress.md).

## Development

Use Node 24 or newer and Python 3.13. Docker packages the actual conversion dependencies.

```sh
npm ci --ignore-scripts
python -m pip install -r requirements-worker.txt
npm test
npm run test:python
npm start
```

The UI runs at http://localhost:3003. Without a configured worker it correctly displays unavailable platforms. `runtime/` contains local SQLite and files; it must not be committed or served statically.

## Architecture

- Public listener: port 3003, optional `BASE_PATH` (production `/mp3maker`).
- Internal listener: port 3004, worker credentials required. Never route this port publicly.
- Jobs survive browser refresh/disconnection. Cancellation is explicit. Interrupted active jobs fail after API restart.
- One running job per worker, two globally, ten queued. Each client gets one outstanding job and five submissions per hour.
- Jobs time out after ten minutes; completed files expire after one hour. Worker temporary storage and result uploads are bounded.
- Worker media traffic goes through the HTTPS proxy on an internal Docker network. It rejects private, loopback, metadata and reserved addresses after DNS resolution.
- No cookies, Google credentials, generic extractors, public admin logs, or host pip updates during runtime.

## Public API

All paths are relative to `BASE_PATH`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/platforms` | Current availability and duration limit |
| POST | `/api/jobs` | Submit `{url}`; returns `{id, token}` |
| GET | `/api/jobs/:id` | Retrieve status with bearer job token |
| GET | `/api/jobs/:id/events` | Reconnectable SSE snapshot/progress |
| POST | `/api/jobs/:id/cancel` | Explicit cancellation |
| GET | `/api/jobs/:id/file` | Retrieve ready MP3 |
| GET | `/health` | Basic liveness |

Events and file requests also accept the job token as a query parameter. Do not log query strings. The browser stores its current job credentials in session storage and polls for status, recovering after transient connection failures.

See [SETUP.md](SETUP.md) for deployment configuration and remaining release checks.
