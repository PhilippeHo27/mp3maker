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

## Desktop worker matrix

Recorded 2026-09-06 from the desktop on a residential connection, after enabling firmware virtualization. Identical image and flags to the Hetzner run: the worker ran `mp3maker-worker:reliable` with the same `--read-only`, `/tmp` tmpfs at 192 MiB, 768m memory, 1 CPU, 128 pids, `--cap-drop ALL`, on an `--internal` Docker network with all media traffic forced through the same egress proxy design. Sample URLs were imported directly from `infra/acceptance.py`. Toolchain verified identical via `selftest`: Python 3.13.7, yt-dlp 2026.8.19, Deno 2.9.6, FFmpeg 5.1.9, provider plugin 1.3.2.

| Configuration | Successful completed MP3 conversions | Outcome |
| --- | --- | --- |
| Bandcamp, default | 4 / 4 | Control; matches Hetzner, confirms the local rig is valid |
| SoundCloud, default | 4 / 4 | Every Hetzner `platform_blocked` failure cleared |
| YouTube, default | 8 / 10 | The two failures are `duration_limit` on an over-length sample, which is correct behaviour |

**No sample returned `platform_blocked` from the desktop.** Every Hetzner failure carried that code; none reproduced. `youtube-demo` failed on Hetzner as `platform_blocked` but reaches `duration_limit` from the desktop, so the block there masked the real disposition. Excluding that intentionally-rejected sample, eligible YouTube samples passed 8 / 8 against 2 / 8 on Hetzner.

The controlled variable was the source address. Image, flags, egress path and URLs were held constant, so the Hetzner failures are attributable to datacenter address reputation rather than to extraction logic, yt-dlp version, or PO tokens. This is consistent with the PO-token batch changing nothing on Hetzner.

Raw reports are in `desktop/`. As with the server matrix this is feasibility evidence at a point in time, not a guarantee of continued access. Address reputation is not static, and sustained automated volume from a residential address is the most likely way to lose it.

## Desktop blocker

Resolved 2026-09-06. Intel VT-x was disabled in firmware on the ASUS TUF Z390-PLUS board; enabling it restored the hypervisor and Docker Desktop. `HypervisorPresent` is now `True`.

Note for future checks: once the hypervisor is running, `VirtualizationFirmwareEnabled` reports `False` because Windows runs in the root partition and can no longer read the firmware flag directly. `HypervisorPresent: True` is the correct signal. The earlier blocked state showed both as `False`.

## Integration

The web image built on Hetzner. `infra/integration_check.py` exercises the real web service and worker in temporary containers, a disposable data tmpfs, private worker traffic, and a host loopback-only test port. It cleans up its containers afterwards. The successful result is saved as `hetzner-integration.json`.

## Still required before release

Desktop image comparison is complete; see the desktop matrix above. Coolify configuration, Traefik routing and the manual release are done, and Bandcamp is live at `philippeho.dev/mp3maker`.

Outstanding: final platform assignments; desktop worker startup and Tailscale private connectivity; browser acceptance for real conversions and failure states; rollback image.

YouTube and SoundCloud still have not passed on the Hetzner worker and must remain disabled there. The desktop evidence justifies relocating the worker, not enabling those platforms on the current server-side worker. Access control should be settled before any residential-address worker serves public traffic.
