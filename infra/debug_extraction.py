import os, re, subprocess, sys
from worker.runner import command
url = sys.argv[1]
args = command(sys.argv[2], os.environ.get('HTTPS_PROXY')) + ['--dump-single-json','--skip-download','--',url]
result = subprocess.run(args, capture_output=True, text=True, timeout=90)
print('exit', result.returncode)
print(re.sub(r'https?://\S+', '[URL redacted]', result.stderr)[-5000:])
