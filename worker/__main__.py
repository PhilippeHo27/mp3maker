import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request

from .runner import execute, JobError


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise JobError('control_plane_error')


class API:
    def __init__(self, url, token, worker_id):
        self.url, self.token, self.worker_id = url.rstrip('/'), token, worker_id
        # The private control plane must never be sent through the media proxy.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def post(self, path, data=None, *, file=None, headers=None, timeout=5):
        fields = {'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'}
        fields.update(headers or {})
        if file is None:
            body = json.dumps(data).encode()
        else:
            body = file
        request = urllib.request.Request(self.url + path, data=body, headers=fields, method='POST')
        try:
            with self.opener.open(request, timeout=timeout) as response:
                return json.loads(response.read(65536))
        except Exception:
            raise JobError('control_plane_error') from None


def versions():
    result = {'python': platform.python_version(), 'yt-dlp': importlib.metadata.version('yt-dlp'),
              'potProvider': importlib.metadata.version('bgutil-ytdlp-pot-provider')}
    for name in ('ffmpeg', 'ffprobe', 'deno'):
        output = subprocess.run([name, '-version' if name.startswith('ff') else '--version'],
                                capture_output=True, text=True, timeout=5, check=True).stdout
        result[name] = output.splitlines()[0][:160]
    return result


def service():
    token = os.environ['WORKER_TOKEN']
    if len(token) < 32:
        raise JobError('invalid_configuration')
    api = API(os.environ['API_URL'], token, os.environ['WORKER_ID'])
    platforms = [p.strip() for p in os.environ.get('WORKER_PLATFORMS', '').split(',') if p.strip()]
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
    if not proxy or not platforms:
        raise JobError('invalid_configuration')
    runtime_versions = versions()
    stopped = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stopped.set())
    def heartbeat():
        while not stopped.is_set():
            try:
                api.post('/internal/heartbeat', {'workerId': api.worker_id, 'platforms': platforms, 'versions': runtime_versions})
            except JobError:
                pass
            stopped.wait(10)
    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    while not stopped.is_set():
        try:
            job = api.post('/internal/claim', {'workerId': api.worker_id}).get('job')
            if not job:
                stopped.wait(2)
                continue
            auth = {'workerId': api.worker_id, 'leaseToken': job['leaseToken']}
            job_path = '/internal/jobs/' + urllib.parse.quote(job['id'], safe='')
            deadline = time.monotonic() + 600
            def progress(**state):
                if stopped.is_set():
                    return True
                response = api.post(job_path + '/progress', dict(auth, **state))
                return bool(response.get('cancelled'))
            try:
                if job['platform'] not in platforms:
                    raise JobError('unsupported_platform')
                with tempfile.TemporaryDirectory(prefix='mp3maker-') as directory:
                    path, title, duration = execute(job['url'], job['platform'], directory, proxy=proxy, progress=progress, deadline=deadline)
                    if progress(state='converting', percent=99, title=title, message='Saving MP3'):
                        raise JobError('cancelled')
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise JobError('timeout')
                    with path.open('rb') as audio:
                        api.post(job_path + '/result', file=audio, timeout=min(120, remaining), headers={
                            'Content-Type': 'audio/mpeg', 'Content-Length': str(path.stat().st_size),
                            'X-Worker-Id': api.worker_id, 'X-Lease-Token': job['leaseToken'],
                            'X-Track-Title': urllib.parse.quote(title, safe='')})
            except Exception as exc:
                code = str(exc) if isinstance(exc, JobError) else 'worker_error'
                api.post(job_path + '/fail', dict(auth, code=code))
        except JobError:
            stopped.wait(2)


def main():
    parser = argparse.ArgumentParser(description='Isolated MP3 conversion worker')
    sub = parser.add_subparsers(dest='mode')
    sub.add_parser('selftest')
    feasibility = sub.add_parser('feasibility')
    feasibility.add_argument('url')
    feasibility.add_argument('--platform', required=True, choices=['youtube', 'soundcloud', 'bandcamp'])
    feasibility.add_argument('--report', default=None)
    feasibility.add_argument('--output', default=None)
    args = parser.parse_args()
    if args.mode == 'selftest':
        print(json.dumps({'versions': versions()}))
        import unittest
        suite = unittest.defaultTestLoader.discover(str(Path(__file__).resolve().parent.parent / 'tests'), pattern='worker_test.py')
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    if args.mode == 'feasibility':
        report = {'platform': args.platform, 'ok': False}
        started = time.monotonic()
        try:
            report['versions'] = versions()
            with tempfile.TemporaryDirectory(prefix='mp3maker-feasibility-') as root:
                result, title, duration = execute(args.url, args.platform, root,
                    proxy=os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY'))
                report.update(ok=True, title=title, durationSeconds=duration, bytes=result.stat().st_size)
                if args.output:
                    shutil.copyfile(result, args.output)
        except Exception as exc:
            report['code'] = str(exc) if isinstance(exc, JobError) else 'worker_error'
        report['elapsedSeconds'] = round(time.monotonic() - started, 2)
        serialized = json.dumps(report, indent=2)
        print(serialized)
        if args.report:
            Path(args.report).write_text(serialized, encoding='utf-8')
        return 0 if report['ok'] else 1
    service()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
