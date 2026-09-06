"""Explicit Hetzner staging smoke test; no production routes or stored credentials.

Requires the three mp3maker images and mp3-feasibility-internal/egress fixture.
Run on the host with python3 infra/integration_check.py.
"""
import json
import secrets
import subprocess
import time
import urllib.error
import urllib.request


def docker(*args):
    return subprocess.run(['sudo', '-n', 'docker', *args], capture_output=True,
                          text=True, check=True, timeout=60).stdout.strip()


def request(path, body=None, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request('http://127.0.0.1:13033/mp3maker' + path,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers=headers)
    with urllib.request.urlopen(req, timeout=10) as response:
        payload = response.read()
        return json.loads(payload) if 'application/json' in response.headers.get('Content-Type', '') else payload


def main():
    credential = secrets.token_urlsafe(32)
    web, worker = 'mp3-integration-web', 'mp3-integration-worker'
    created = []
    report = {'ok': False, 'checks': []}
    try:
        docker('run', '-d', '--name', web, '--init', '--read-only',
               '--network', 'mp3-feasibility-internal', '-p', '127.0.0.1:13033:3003',
               '--tmpfs', '/data:size=192m,uid=1000,gid=1000', '--tmpfs', '/tmp:size=16m',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
               '-e', 'BASE_PATH=/mp3maker', '-e', 'ENABLED_PLATFORMS=bandcamp',
               '-e', 'WORKER_TOKENS=' + json.dumps({'integration': credential}),
               '-e', 'WORKER_ASSIGNMENTS=' + json.dumps({'integration': ['bandcamp']}),
               'mp3maker-web:acceptance')
        created.append(web)
        # Mirror compose.yaml: only the web service joins the edge network.
        # An internal-only Docker network cannot publish the host test port.
        docker('network', 'connect', 'bridge', web)
        docker('run', '-d', '--name', worker, '--init', '--read-only',
               '--network', 'mp3-feasibility-internal', '--tmpfs', '/tmp:size=192m,mode=1777',
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
               '-e', 'API_URL=http://' + web + ':3004', '-e', 'WORKER_ID=integration',
               '-e', 'WORKER_TOKEN=' + credential, '-e', 'WORKER_PLATFORMS=bandcamp',
               '-e', 'HTTPS_PROXY=http://mp3-feasibility-egress:3128',
               'mp3maker-worker:reliable')
        created.append(worker)
        deadline = time.monotonic() + 60
        while True:
            try:
                if request('/api/platforms')['platforms']['bandcamp']['available']:
                    break
            except (OSError, ValueError):
                pass
            if time.monotonic() > deadline:
                raise RuntimeError('worker_registration_timeout')
            time.sleep(1)
        report['checks'].append('private_worker_registration')
        docker('exec', worker, 'python', '-c',
               "import socket,sys\ntry:\n socket.create_connection(('1.1.1.1',443),timeout=2)\nexcept OSError:\n sys.exit(0)\nraise RuntimeError('direct_egress_allowed')")
        docker('exec', worker, 'python', '-c',
               "import urllib.request,urllib.error\n"
               "opener=urllib.request.build_opener(urllib.request.ProxyHandler({'https':'http://mp3-feasibility-egress:3128'}))\n"
               "try:\n opener.open('https://169.254.169.254/',timeout=5)\n"
               "except urllib.error.URLError as error:\n assert '403' in str(error), 'unexpected_proxy_error'\n"
               "else:\n raise RuntimeError('metadata_access_allowed')")
        docker('exec', web, 'node', '-e',
               "fetch('http://127.0.0.1:3004/internal/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>process.exit(r.status===403?0:1))")
        report['checks'].extend(['direct_egress_blocked', 'metadata_proxy_blocked', 'internal_authentication'])
        job = request('/api/jobs', {'url': 'https://youtube-dl.bandcamp.com/track/youtube-dl-test-song'})
        states = []
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            state = request('/api/jobs/' + job['id'], token=job['token'])
            if not states or states[-1] != state['state']:
                states.append(state['state'])
            if state['state'] in ('failed', 'cancelled', 'ready'):
                break
            time.sleep(1)
        if state['state'] != 'ready':
            raise RuntimeError('conversion_' + str(state.get('code') or state['state']))
        audio = request('/api/jobs/' + job['id'] + '/file', token=job['token'])
        if len(audio) < 128 or not (audio.startswith(b'ID3') or audio[0] == 255):
            raise RuntimeError('invalid_audio')
        report.update(ok=True, states=states, bytes=len(audio))
        report['checks'].extend(['job_creation', 'worker_claim', 'real_bandcamp_conversion',
                                 'result_upload', 'authenticated_download', 'production_base_path'])
    except Exception as error:
        # Never include subprocess command lines, which carry temporary credentials.
        report['error'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    finally:
        for name in reversed(created):
            docker('rm', '-f', name)
    print(json.dumps(report, indent=2))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
