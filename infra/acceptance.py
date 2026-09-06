#!/usr/bin/env python3
"""Run explicit, bounded live acceptance checks; save public-safe JSON reports."""
import json
import pathlib
import subprocess
import time

SAMPLES = [
 ('youtube','youtube-ordinary','https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
 ('youtube','youtube-short-video','https://www.youtube.com/watch?v=jNQXAC9IVRw'),
 ('youtube','youtube-demo','https://www.youtube.com/watch?v=M7lc1UVf-VE'),
 ('youtube','youtube-shorts','https://www.youtube.com/shorts/18NGQq7p3LY'),
 ('youtube','youtube-long','https://www.youtube.com/watch?v=aqz-KE-bpKQ'),
 ('soundcloud','soundcloud-test','https://soundcloud.com/ethmusic/lostin-powers-she-so-heavy'),
 ('soundcloud','soundcloud-track','https://soundcloud.com/the80m/the-following'),
 ('bandcamp','bandcamp-test','https://youtube-dl.bandcamp.com/track/youtube-dl-test-song'),
 ('bandcamp','bandcamp-track','https://benprunty.bandcamp.com/track/lanius-battle'),
]
if __name__ == '__main__':
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('--platform');parser.add_argument('--pot',action='store_true');args=parser.parse_args()
 directory=pathlib.Path('reports');directory.mkdir(exist_ok=True)
 for platform,label,url in SAMPLES:
  if args.platform and platform!=args.platform:continue
  for attempt in range(1,3):
   cmd=['sudo','-n','docker','run','--rm','--init','--network','mp3-feasibility-internal',
        '--read-only','--tmpfs','/tmp:size=192m,mode=1777','--memory','768m','--cpus','1','--pids-limit','128',
        '--cap-drop','ALL','--security-opt','no-new-privileges',
        '-e','HTTPS_PROXY=http://mp3-feasibility-egress:3128']
   if args.pot:cmd+=['-e','POT_URL=http://mp3-feasibility-pot:4416','-e','NO_PROXY=mp3-feasibility-pot']
   cmd+=['mp3maker-worker:reliable','feasibility',url,'--platform',platform]
   started=time.monotonic()
   try:
    completed=subprocess.run(cmd,capture_output=True,text=True,timeout=620)
    result=json.loads(completed.stdout)
   except Exception as error:
    result={'ok':False,'code':type(error).__name__}
   result.update(sample=label,attempt=attempt,pot=args.pot)
   (directory/f'{label}-{attempt}-{"pot" if args.pot else "default"}.json').write_text(json.dumps(result,indent=2))
   print(json.dumps(result),flush=True)
   time.sleep(5)
