#!/usr/bin/env python3
"""📣 Short product videos for YouTube Shorts and TikTok (lib/services/social.ts, .github/workflows/social-video.yml).

Asks the shop which products need a video (GET /api/social-video-jobs), makes a 9-second 1080x1920 video of each with
ffmpeg — the product photo slowly growing over a blurred copy of itself, the price in big letters, the shop's address
and "Cash on Delivery" — and writes it to <out>/videos/<id>.mp4, listed in <out>/index.json. Only the newest 40 are
kept, so the branch stays small. Standard library + ffmpeg only.

    python3 tools/socialvideo/make.py --shop https://shobmilbe.com --out /tmp/vid
"""
import argparse, json, os, subprocess, sys, tempfile, textwrap, time, urllib.request

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
UA = {'User-Agent': 'shobmilbe-social-video'}
KEEP = 40
SECONDS = 9


def get(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def make(job, out_file, work):
    img = os.path.join(work, 'in.jpg')
    with open(img, 'wb') as f:
        f.write(get(job['image']))
    files = {}
    for key, text in (('price', job.get('price', '')), ('name', '\n'.join(textwrap.wrap(job.get('name', ''), 26)[:2])), ('foot', 'shobmilbe.com  |  Cash on Delivery')):
        p = os.path.join(work, key + '.txt')
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text)
        files[key] = p
    draw = [
        "drawbox=x=0:y=1470:w=iw:h=330:color=black@0.55:t=fill",
        f"drawtext=fontfile={FONT}:textfile={files['price']}:fontsize=110:fontcolor=0xFFC83D:x=(w-text_w)/2:y=1505",
        f"drawtext=fontfile={FONT}:textfile={files['foot']}:fontsize=46:fontcolor=white:x=(w-text_w)/2:y=1665",
    ]
    if job.get('name'):
        draw.append(f"drawtext=fontfile={FONT}:textfile={files['name']}:fontsize=58:fontcolor=white:line_spacing=12:box=1:boxcolor=black@0.45:boxborderw=24:x=(w-text_w)/2:y=170")
    graph = ';'.join([
        "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=40:4,eq=brightness=-0.12[bg]",
        "[0:v]scale=900:1050:force_original_aspect_ratio=decrease,setsar=1[fg0]",
        f"[fg0]scale=w='trunc(iw*(1+0.10*t/{SECONDS})/2)*2':h=-2:eval=frame[fg]",
        "[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2-60[v0]",
        "[v0]" + ','.join(draw) + f",fade=t=in:st=0:d=0.5,fade=t=out:st={SECONDS - 0.6}:d=0.6,format=yuv420p[v]",
    ])
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-framerate', '30', '-t', str(SECONDS), '-i', img,
           '-f', 'lavfi', '-t', str(SECONDS), '-i', 'anullsrc=r=44100:cl=stereo',
           '-filter_complex', graph, '-map', '[v]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
           '-r', '30', '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart', out_file]
    subprocess.run(cmd, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shop', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    jobs = json.loads(get(a.shop.rstrip('/') + '/api/social-video-jobs')).get('jobs', [])
    os.makedirs(os.path.join(a.out, 'videos'), exist_ok=True)
    index_path = os.path.join(a.out, 'index.json')
    try:
        index = json.load(open(index_path))
    except Exception:
        index = {}
    made = 0
    for job in jobs:
        pid = str(int(job['id']))
        if pid in index:
            continue
        try:
            with tempfile.TemporaryDirectory() as work:
                make(job, os.path.join(a.out, 'videos', pid + '.mp4'), work)
            index[pid] = {'made': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
            made += 1
            print('made', pid)
        except Exception as e:  # one bad picture never stops the others
            print('::warning::product', pid, e, file=sys.stderr)
    # keep the newest few only
    for pid in sorted(index, key=lambda k: index[k]['made'], reverse=True)[KEEP:]:
        index.pop(pid, None)
        try:
            os.remove(os.path.join(a.out, 'videos', pid + '.mp4'))
        except FileNotFoundError:
            pass
    json.dump(index, open(index_path, 'w'), indent=0)
    print(f'videos made: {made}, kept: {len(index)}')


if __name__ == '__main__':
    main()
