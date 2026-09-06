import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from worker.runner import JobError, validate_metadata, run_process, execute


class ServiceTests(unittest.TestCase):
    def test_actual_ytdlp_accepts_worker_arguments(self):
        import subprocess
        from worker.runner import command
        result = subprocess.run(command('youtube', 'http://proxy:3128') + ['--help'], capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_api_bypasses_media_proxy_and_uses_bearer(self):
        from worker.__main__ import API
        from http.server import BaseHTTPRequestHandler, HTTPServer
        import threading
        received = []
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                received.append((self.path, self.headers.get('Authorization'), self.rfile.read(int(self.headers['Content-Length']))))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
            def log_message(self, *args):
                pass
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.dict('os.environ', {'HTTP_PROXY': 'http://127.0.0.1:1'}):
                api = API('http://127.0.0.1:' + str(server.server_port), 'x'*32, 'test')
                self.assertEqual(api.post('/internal/heartbeat', {'workerId': 'test'}), {'ok': True})
            self.assertEqual(received[0][1], 'Bearer ' + 'x'*32)
        finally:
            server.shutdown()
            server.server_close()


class MetadataTests(unittest.TestCase):
    def test_accepts_inclusive_limit(self):
        self.assertEqual(validate_metadata({'duration': 900, 'title': 'Track'}), 'Track')

    def test_rejects_all_non_single_public_finite_tracks(self):
        invalid = [{'duration': n} for n in [None, 0, -1, 900.01, float('inf'), float('nan'), True]]
        invalid += [dict(duration=30, **extra) for extra in [
            {'_type': 'playlist'}, {'entries': []}, {'is_live': True},
            {'live_status': 'is_upcoming'}, {'live_status': 'is_live'},
            {'availability': 'needs_auth'}, {'availability': 'subscriber_only'},
            {'availability': 'premium_only'}, {'availability': 'private'},
        ]]
        for metadata in invalid:
            with self.subTest(metadata=metadata), self.assertRaises(JobError):
                validate_metadata(metadata)


class ProcessTests(unittest.TestCase):
    def run_script(self, code, **kwargs):
        with tempfile.TemporaryDirectory() as root:
            return run_process([sys.executable, '-c', code], Path(root), **kwargs)

    def test_timeout_stops_silent_process(self):
        start = time.monotonic()
        with self.assertRaisesRegex(JobError, 'timeout'):
            self.run_script('import time; time.sleep(60)', deadline=start + .2)
        self.assertLess(time.monotonic() - start, 4)

    def test_cancel_stops_silent_process(self):
        with self.assertRaisesRegex(JobError, 'cancelled'):
            self.run_script('import time; time.sleep(60)', deadline=time.monotonic() + 5, poll=lambda: True)

    def test_disk_overflow_stops_process(self):
        with self.assertRaisesRegex(JobError, 'size_limit'):
            self.run_script("from pathlib import Path; import time; Path('big').write_bytes(b'x'*10000); time.sleep(60)", deadline=time.monotonic() + 5, max_bytes=100)

    def test_output_is_bounded_and_error_is_redacted(self):
        with self.assertRaisesRegex(JobError, '^extract_failed$'):
            self.run_script("import sys; print('https://secret.example/token?key=private'); sys.exit(1)", deadline=time.monotonic() + 5)

    def test_bot_errors_are_classified_without_exposing_response(self):
        with self.assertRaisesRegex(JobError, '^platform_blocked$'):
            self.run_script("import sys; sys.stderr.write(\"Sign in to confirm you're not a bot https://secret.example/token\"); sys.exit(1)", deadline=time.monotonic() + 5)

    def test_failed_artwork_preserves_audio(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            def fake_run(args, directory, **kwargs):
                if '--dump-single-json' in args:
                    return json.dumps({'duration': 20, 'title': 'Track'})
                if '--write-thumbnail' in args:
                    raise JobError('extract_failed')
                if '--output' in args:
                    (root / 'source.webm').write_bytes(b'audio')
                if args[0] == 'ffmpeg':
                    (root / 'result.mp3').write_bytes(b'mp3')
                if args[0] == 'ffprobe':
                    return json.dumps({'format': {'duration': '20', 'format_name': 'mp3'}})
                return ''
            with patch('worker.runner.run_process', side_effect=fake_run):
                result, title, duration = execute('https://youtu.be/abcdefghijk', 'youtube', root, proxy='http://proxy:3128')
            self.assertEqual(result.read_bytes(), b'mp3')
            self.assertEqual(title, 'Track')


if __name__ == '__main__':
    unittest.main()
