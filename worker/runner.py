"""One bounded, cancellable extraction pipeline, shared by service and feasibility CLI."""
import json
import math
import os
import re
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

MAX_BYTES = 150 * 1024 * 1024
EXTRACTORS = {'youtube': 'youtube', 'soundcloud': 'soundcloud', 'bandcamp': 'bandcamp'}


class JobError(Exception):
    """Only fixed, public-safe codes leave the worker."""


def validate_metadata(info):
    if not isinstance(info, dict) or info.get('_type', 'video') != 'video' or 'entries' in info:
        raise JobError('playlist_not_allowed')
    if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming', 'post_live'):
        raise JobError('live_not_allowed')
    if info.get('availability') not in (None, 'public', 'unlisted'):
        raise JobError('authentication_required')
    duration = info.get('duration')
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0:
        raise JobError('unknown_duration')
    if duration > 900:
        raise JobError('duration_limit')
    return ''.join(c for c in str(info.get('title') or 'Audio') if c.isprintable())[:200] or 'Audio'


def directory_size(root):
    total = 0
    for path in root.rglob('*'):
        try:
            if path.is_file():
                total += path.stat().st_size
        except FileNotFoundError:
            pass
    return total


def kill_group(process):
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait(timeout=5)


def run_process(args, directory, *, deadline, poll=lambda: False, max_bytes=MAX_BYTES, error='extract_failed', on_line=lambda line: None):
    if time.monotonic() >= deadline:
        raise JobError('timeout')
    output = bytearray()
    errors = bytearray()
    overflow = threading.Event()
    # No shell, stdin, inherited user configuration, or unbounded log files.
    process = subprocess.Popen(args, cwd=directory, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=os.name != 'nt',
                               creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)
    def drain():
        pending = ''
        while chunk := process.stdout.read1(8192):
            pending += chunk.decode('utf-8', errors='replace')
            lines = pending.split('\n')
            pending = lines.pop()[-8192:]
            for line in lines:
                on_line(line)
            if len(output) + len(chunk) <= 8 * 1024 * 1024:
                output.extend(chunk)
            else:
                overflow.set()
    def drain_errors():
        while chunk := process.stderr.read(8192):
            errors.extend(chunk)
            if len(errors) > 16384:
                del errors[:-16384]
    error_reader = threading.Thread(target=drain_errors, daemon=True)
    error_reader.start()
    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    next_poll = 0
    try:
        while True:
            now = time.monotonic()
            if now >= deadline:
                raise JobError('timeout')
            if directory_size(directory) > max_bytes or overflow.is_set():
                raise JobError('size_limit')
            if now >= next_poll:
                if poll():
                    raise JobError('cancelled')
                next_poll = now + 1
            if process.poll() is not None:
                break
            time.sleep(.1)
        reader.join(timeout=1)
        if directory_size(directory) > max_bytes or overflow.is_set():
            raise JobError('size_limit')
        if process.returncode:
            error_reader.join(timeout=1)
            detail = errors.decode('utf-8', errors='replace').lower()
            if any(marker in detail for marker in ("not a bot", 'http error 403', 'http error 429', 'too many requests')):
                raise JobError('platform_blocked')
            raise JobError(error)
        return output.decode('utf-8', errors='replace')
    except BaseException:
        kill_group(process)
        raise
    finally:
        reader.join(timeout=1)
        process.stdout.close()
        error_reader.join(timeout=1)
        process.stderr.close()


def command(platform, proxy):
    if platform not in EXTRACTORS:
        raise JobError('unsupported_platform')
    if not proxy:
        raise JobError('proxy_required')
    args = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-cookies', '--no-cookies-from-browser',
            '--no-playlist', '--no-cache-dir',
            '--use-extractors', EXTRACTORS[platform], '--proxy', proxy, '--socket-timeout', '15',
            '--retries', '2', '--fragment-retries', '2', '--extractor-retries', '2',
            '--no-js-runtimes', '--js-runtimes', 'deno', '--no-remote-components', '--fixup', 'never',
            '--downloader', 'native', '--max-filesize', str(MAX_BYTES)]
    pot = os.environ.get('POT_URL')
    if pot:
        args += ['--extractor-args', 'youtubepot-bgutilhttp:base_url=' + pot,
                 '--extractor-args', 'youtubepot-bgutilscript:disable=true']
    else:
        args += ['--extractor-args', 'youtubepot-bgutilhttp:disable=true',
                 '--extractor-args', 'youtubepot-bgutilscript:disable=true']
    return args


def execute(url, platform, root, *, proxy, progress=lambda **kw: False, deadline=None):
    root = Path(root).resolve()
    deadline = deadline or time.monotonic() + 600
    state = {'state': 'fetching', 'percent': 5, 'message': 'Checking track'}
    def poll():
        return progress(**state)
    def run(args, **kw):
        return run_process(args, root, deadline=deadline, poll=poll, **kw)
    base = command(platform, proxy)
    try:
        info = json.loads(run(base + ['--dump-single-json', '--skip-download', '--', url]))
    except (ValueError, TypeError):
        raise JobError('extract_failed') from None
    title = validate_metadata(info)
    state.update(title=title, state='downloading', percent=15, message='Downloading audio')
    def download_line(line):
        match = re.search(r'MP3_PROGRESS:\s*([0-9.]+)%', line)
        if match:
            state['percent'] = 15 + min(100, float(match.group(1))) * .55
    run(base + ['--newline', '--progress', '--progress-template', 'download:MP3_PROGRESS:%(progress._percent_str)s',
                '--format', 'bestaudio/best', '--output', 'source.%(ext)s', '--', url], on_line=download_line)
    sources = [p for p in root.glob('source.*') if p.suffix not in ('.part', '.ytdl', '.json')]
    if len(sources) != 1:
        raise JobError('download_failed')
    state.update(state='converting', percent=75, message='Creating MP3')
    result = root / 'result.mp3'
    # MP3 framing adds padding: leave <0.1 sec headroom at the 900-second ceiling.
    run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file,pipe',
         '-i', str(sources[0]), '-map', '0:a:0', '-vn', '-t', '899.9', '-c:a', 'libmp3lame', '-b:a', '192k',
         '-map_metadata', '-1', '-metadata', 'title=' + title, '-metadata', 'artist=' + str(info.get('artist') or info.get('uploader') or '')[:200],
         '-id3v2_version', '3', str(result)], error='conversion_failed')
    sources[0].unlink(missing_ok=True)
    # Artwork is optional and cannot turn a valid conversion into a failure.
    try:
        run(base + ['--skip-download', '--write-thumbnail', '--output', 'art.%(ext)s', '--', url])
        pictures = list(root.glob('art.*'))
        if pictures:
            decorated = root / 'decorated.mp3'
            run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
                 '-protocol_whitelist', 'file,pipe', '-i', str(result), '-protocol_whitelist', 'file,pipe', '-i', str(pictures[0]),
                 '-map', '0:a:0', '-map', '1:v:0', '-c:a', 'copy', '-c:v', 'mjpeg', '-frames:v', '1',
                 '-disposition:v:0', 'attached_pic', '-id3v2_version', '3', str(decorated)], error='artwork_failed')
            decorated.replace(result)
    except JobError as exc:
        if str(exc) in ('timeout', 'cancelled', 'size_limit'):
            raise
    state.update(percent=95, message='Verifying MP3')
    try:
        probe = json.loads(run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_format', '-of', 'json', str(result)], error='conversion_failed'))
        duration = float(probe['format']['duration'])
        if probe['format']['format_name'] != 'mp3' or not math.isfinite(duration) or not 0 < duration <= 900:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise JobError('conversion_failed') from None
    return result, title, duration

