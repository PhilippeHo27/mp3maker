# Download acceptance evidence

Status checked 2026-09-06. This is evidence for feasibility, not a guarantee that a source will remain accessible.

## Hetzner worker matrix

| Configuration | Successful completed MP3 conversions | Outcome |
| --- | --- | --- |
| Bandcamp, default | 4 / 4 | Two tracks, twice each; FFprobe verification passed |
| SoundCloud, default | 0 / 4 | HTTP 403 while fetching the page |
| YouTube, default | 2 / 10 | Only one of five sample videos passed, twice |
| YouTube, automatic PO-token companion | 2 / 10 | Same sample passed; other attempts reported platform blocking |

Raw public-safe reports are in `hetzner/`. Default reports were recovered from the previous session; the PO-token batch was executed by the resumed task. Sample URLs are listed in `infra/acceptance.py`. The worker records versions and checks the produced MP3 using FFprobe before reporting success.

The worker image is `mp3maker-worker:reliable`, local image ID prefix `339126b077db`, with Python 3.13.7, yt-dlp 2026.8.19, Deno 2.9.6, FFmpeg 5.1.9, and provider plugin 1.3.2. The companion tested was `brainicism/bgutil-ytdlp-pot-provider:1.3.2@sha256:9a96e6385ce1928da87dea07b1cab0413d2cf8c07a3b8a8bd419f53df2c3843c`.

Provider setup follows the [upstream project](https://github.com/Brainicism/bgutil-ytdlp-pot-provider). The companion was private on the feasibility network and had no published host port. No cookies or account credentials were supplied.

## Desktop blocker

A normal Docker Desktop restart did not restore the engine. Docker logs report `HCS_E_HYPERV_NOT_INSTALLED` and WSL2 cannot start because virtualization is unavailable. Windows CIM reports:

- `HypervisorPresent: False`
- `VirtualizationFirmwareEnabled: False`
- `SecondLevelAddressTranslationExtensions: True`
- `VMMonitorModeExtensions: True`

The CPU exposes the required capabilities, but firmware virtualization is disabled according to Windows. A firmware/Windows configuration change and reboot are outside the completed work. No equivalent-image desktop conversions have been run. Earlier native metadata-only extraction is not a substitute for this test.

## Integration

The web image built on Hetzner. `infra/integration_check.py` exercises the real web service and worker in temporary containers, a disposable data tmpfs, private worker traffic, and a host loopback-only test port. It cleans up its containers afterwards. The successful result is saved as `hetzner-integration.json`.

## Still required before release

Desktop image comparison; final platform assignments; desktop startup and Tailscale connectivity if selected; browser acceptance for real conversions and failure states; actual Coolify configuration, proxy trust, Traefik routing/SSE checks, rollback image, and manual release. YouTube and SoundCloud have not passed the Hetzner gate. No public release was made.
