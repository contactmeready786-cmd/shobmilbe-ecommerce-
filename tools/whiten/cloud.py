"""☁️ ব্যাকগ্রাউন্ড সাদা — অনলাইনে: the cloud AI worker (run by .github/workflows/whiten-cloud.yml on GitHub's computers).

Asks the shop for waiting pictures (GET /api/whiten-jobs), cuts each product out with BiRefNet (the best free model,
MIT licence, public/vendor/birefnet), cleans up what isn't the product (a shop's logo in a corner, a line of text,
small stray pieces), takes the old background's colour out of the edges, optionally brightens the product a little,
puts it on pure white and saves results/<token>.jpg + results/index.json on the `whiten-results` branch. The shop
reads them from there; nothing is ever sent to the shop. A picture the AI can't find a product in is reported, never
saved blank.

  python tools/whiten/cloud.py --shop https://shobmilbe.com --out /path/to/whiten-results-worktree --minutes 9
"""
import argparse, io, json, os, subprocess, sys, time, urllib.request
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

S = 1024
MAX_SIDE = 2000
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
SD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
UA = {'User-Agent': 'shobmilbe-whiten-cloud/1.0'}


def load_model(vendor):
    import onnxruntime as ort
    man = json.load(open(os.path.join(vendor, 'model.json')))
    data = b''.join(open(os.path.join(vendor, p), 'rb').read() for p in man['parts'])
    assert len(data) == man['size'], 'model file incomplete'
    o = ort.SessionOptions()
    o.intra_op_num_threads = os.cpu_count() or 4
    return ort.InferenceSession(data, o, providers=['CPUExecutionProvider'])


def fetch(url, limit=15 * 1024 * 1024):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError('ছবিটা খুব বড়')
    return data


def mask_of(sess, img):
    x = np.asarray(img.resize((S, S), Image.BICUBIC), dtype=np.float32) / 255.0
    x = ((x - MEAN) / SD).transpose(2, 0, 1)[None].astype(np.float32)
    out = sess.run(None, {sess.get_inputs()[0].name: x})[0][0, 0]
    if out.min() < -0.01 or out.max() > 1.01:
        out = 1 / (1 + np.exp(-out))
    return out.astype(np.float32)


def clean_pieces(m):
    """Keep the product: drop small stray pieces, and pieces that look like a shop's logo / phone-number badge / banner /
    text line — wholly in a corner or along the top or bottom edge, or long and thin — whenever a piece in the middle
    of the picture (the product) is there. (2026-10-24: a yellow phone badge stayed on 11 pictures because the product
    was small and the badge nearly as big, so size alone didn't tell them apart.)"""
    lab, n = ndimage.label(m > 0.1)
    if n <= 1:
        return m
    idx = np.arange(1, n + 1)
    area = ndimage.sum(np.ones_like(m), lab, idx)
    big = area.max()
    objs = ndimage.find_objects(lab)
    side = []
    for a, sl in zip(area, objs):
        ys, xs = sl
        h, w = ys.stop - ys.start, xs.stop - xs.start
        edge = ys.stop <= S * 0.26 or ys.start >= S * 0.74  # wholly in the top or bottom band
        corner = (xs.stop <= S * 0.32 or xs.start >= S * 0.68) and (ys.stop <= S * 0.4 or ys.start >= S * 0.6)
        thin = w > h * 5 or h > w * 5
        side.append(edge or corner or thin)
    side = np.array(side)
    middle = [i for i in range(n) if not side[i] and area[i] >= big * 0.03]
    keep = np.zeros(n + 1, dtype=bool)
    if middle:
        prod = max(area[i] for i in middle)
        for i in range(n):
            if area[i] < max(prod, big) * 0.03:
                continue  # dust
            if side[i] and area[i] < prod * 2.5:
                continue  # a logo / badge / banner / text line beside the product
            if not side[i] and area[i] < prod * 0.08:
                continue  # a small stray piece
            keep[i + 1] = True
    else:  # nothing in the middle: the old careful rule
        for i in range(n):
            if area[i] >= big * 0.45 or (area[i] >= big * 0.12 and not side[i]):
                keep[i + 1] = True
        keep[np.argmax(area) + 1] = True
    return np.where(keep[lab], m, 0).astype(np.float32)


def brighten(o, al):
    lum = (0.299 * o[..., 0] + 0.587 * o[..., 1] + 0.114 * o[..., 2])[al >= 0.6]
    if lum.size < 500:
        return o
    lo = min(np.percentile(lum, 0.5), 28)
    hi = max(np.percentile(lum, 99.5), 200)
    gain = min(255 / max(1, hi - lo), 1.3)
    t = np.clip((o - lo) * gain / 255, 0, 1) ** 0.93 * 255
    y = (0.299 * t[..., 0] + 0.587 * t[..., 1] + 0.114 * t[..., 2])[..., None]
    t = y + (t - y) * 1.08
    w = (al > 0)[..., None]
    return np.where(w, np.clip(t, 0, 255), o)


def whiten(sess, data, opts):
    img = Image.open(io.BytesIO(data))
    img.load()
    if img.mode in ('RGBA', 'LA', 'P'):
        img = img.convert('RGBA')
        bg = Image.new('RGBA', img.size, (255, 255, 255, 255))
        bg.alpha_composite(img)
        img = bg
    img = img.convert('RGB')
    k = min(1.0, MAX_SIDE / max(img.size))
    if k < 1:
        img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    W, H = img.size
    m = mask_of(sess, img)
    if opts.get('clean', True):
        m = clean_pieces(m)
    if (m > 0.5).mean() < 0.01:
        raise ValueError('ছবিতে পণ্য চেনা যায়নি')
    a = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR), dtype=np.float32) / 255
    al = np.clip((a - 0.04) / 0.92, 0, 1)
    o = np.asarray(img, dtype=np.float32)
    # clean edges: the old background's colour around each spot, taken out of the part-product edge pixels
    bgw = (1 - al)[..., None]
    rad = max(8, round(max(W, H) / 60))
    num = np.asarray(Image.fromarray(np.clip(o * bgw, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rad)), dtype=np.float32)
    den = np.asarray(Image.fromarray((bgw[..., 0] * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rad)), dtype=np.float32)[..., None] / 255
    local_bg = np.where(den > 0.02, num / np.maximum(den, 1e-3), 255)
    edge = (al > 0.15) & (al < 0.98)
    F = np.clip((o - (1 - al)[..., None] * local_bg) / np.maximum(al, 1e-3)[..., None], 0, 255)
    o = np.where(edge[..., None], F, o)
    if opts.get('bright'):
        o = brighten(o, al)
    out = 255 + (o - 255) * al[..., None]
    res = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    for q in (92, 86, 80):
        buf = io.BytesIO()
        res.save(buf, 'JPEG', quality=q, optimize=True, progressive=True)
        if buf.tell() <= 2.6 * 1024 * 1024:
            break
    return buf.getvalue()


E = 224


def load_dino(vendor):
    return load_model(vendor)


def describe(sess, data):
    """The picture-recognition AI's description, exactly as client/admin/recognize.ts makes it in a browser: the whole
    picture on a white 224 × 224 square, DINOv2's first token, scaled to ±127, one byte each, base64."""
    import base64
    img = Image.open(io.BytesIO(data))
    img.load()
    if img.mode in ('RGBA', 'LA', 'P'):
        img = img.convert('RGBA')
        bg = Image.new('RGBA', img.size, (255, 255, 255, 255))
        bg.alpha_composite(img)
        img = bg
    img = img.convert('RGB')
    k = E / max(img.size)
    w, h = max(1, round(img.width * k)), max(1, round(img.height * k))
    sq = Image.new('RGB', (E, E), (255, 255, 255))
    sq.paste(img.resize((w, h), Image.LANCZOS), ((E - w) // 2, (E - h) // 2))
    x = np.asarray(sq, dtype=np.float32) / 255.0
    x = ((x - MEAN) / SD).transpose(2, 0, 1)[None].astype(np.float32)
    o = sess.run(None, {sess.get_inputs()[0].name: x})[0]
    v = o.reshape(-1)[:384]
    m = float(np.abs(v).max()) or 1.0
    b = (np.round(v * (127 / m)).astype(np.int16) & 0xFF).astype(np.uint8)
    return base64.b64encode(b.tobytes()).decode()


def git(out, *args):
    subprocess.run(['git', '-C', out, *args], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shop', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--vendor', default='public/vendor/birefnet')
    ap.add_argument('--dino', default='public/vendor/dinov2')
    ap.add_argument('--minutes', type=float, default=9)
    ap.add_argument('--redo', action='store_true', help='clean up the pictures already made again (the newest clean-up rule), in place')
    ap.add_argument('--try', dest='try_dir', help='test: make every picture in this folder white into --out (no shop, no git)')
    args = ap.parse_args()
    if args.try_dir:
        sess = load_model(args.vendor)
        os.makedirs(args.out, exist_ok=True)
        for f in sorted(os.listdir(args.try_dir)):
            for bright in (False, True):
                t0 = time.time()
                try:
                    jpg = whiten(sess, open(os.path.join(args.try_dir, f), 'rb').read(), {'clean': True, 'bright': bright})
                    open(os.path.join(args.out, f.rsplit('.', 1)[0] + ('-b' if bright else '') + '.jpg'), 'wb').write(jpg)
                    print(f, 'bright' if bright else '', f'{time.time() - t0:.1f}s')
                except Exception as e:
                    print(f, 'failed:', e)
        return 0
    if args.redo:
        idx_path = os.path.join(args.out, 'results', 'index.json')
        index = json.load(open(idx_path))
        sess = load_model(args.vendor)
        for tok, v in index.items():
            f = os.path.join(args.out, 'results', tok + '.jpg')
            if not (v.get('ok') and os.path.exists(f)):
                continue
            try:
                with open(f, 'rb') as fh:
                    before = fh.read()
                jpg = whiten(sess, before, {'clean': True})  # never brightened twice
                with open(f, 'wb') as fh:  # opened only now: opening for writing empties the file
                    fh.write(jpg)
                print('redone', tok, flush=True)
            except Exception as e:
                print(f'::warning::{tok}: {e}', flush=True)
        publish(args.out, index, idx_path, 'whiten: cleaned again')
        return 0
    os.makedirs(os.path.join(args.out, 'results'), exist_ok=True)
    idx_path = os.path.join(args.out, 'results', 'index.json')
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else {}
    sess = None
    stop_at = time.time() + args.minutes * 60
    emb_path = os.path.join(args.out, 'results', 'emb.json')
    embs = json.load(open(emb_path)) if os.path.exists(emb_path) else {}
    dino = None
    while time.time() < stop_at:
        try:
            got = json.loads(fetch(args.shop.rstrip('/') + '/api/whiten-jobs').decode())
        except Exception as e:
            print('jobs list failed:', e, flush=True)
            got = {}
        jobs = [j for j in got.get('jobs', []) if j['token'] not in index]
        pics = [p for p in got.get('emb', []) if str(p['id']) not in embs]
        if pics:
            # 🧠 picture recognition for the duplicate check (the shop copies results/emb.json in by itself)
            if dino is None:
                dino = load_dino(args.dino)
            t0, n = time.time(), 0
            for p in pics:
                try:
                    embs[str(p['id'])] = describe(dino, fetch(p['src']))
                    n += 1
                except Exception as e:
                    embs[str(p['id'])] = ''  # unreadable: never asked again
                    print(f"pic {p['id']}: {e}", flush=True)
            json.dump(embs, open(emb_path, 'w'), separators=(',', ':'))
            publish(args.out, index, idx_path, f'recognize: {len(pics)} picture(s)')
            print(f'described {n}/{len(pics)} pictures in {time.time() - t0:.0f}s', flush=True)
            stop_at = max(stop_at, time.time() + 4 * 60)
        if not jobs:
            if not pics:
                time.sleep(15)
            continue
        if sess is None:
            t0 = time.time()
            sess = load_model(args.vendor)
            print(f'AI ready in {time.time() - t0:.1f}s', flush=True)
        for j in jobs:
            t0 = time.time()
            try:
                jpg = whiten(sess, fetch(j['src']), j.get('opts') or {})
                open(os.path.join(args.out, 'results', j['token'] + '.jpg'), 'wb').write(jpg)
                index[j['token']] = {'ok': True}
                print(f"job {j['id']}: done in {time.time() - t0:.1f}s ({len(jpg) // 1024} KB)", flush=True)
            except Exception as e:
                index[j['token']] = {'ok': False, 'error': str(e)[:200]}
                print(f"::warning::job {j['id']}: failed: {e}", flush=True)
            # each picture goes out as soon as it is ready, so the owner sees them one by one
            publish(args.out, index, idx_path, f"whiten: job {j['id']}")
        stop_at = max(stop_at, time.time() + 6 * 60)  # more may come: keep watching a little longer
    return 0


def publish(out, index, idx_path, msg):
    json.dump(index, open(idx_path, 'w'))
    git(out, 'add', '-A')
    git(out, 'commit', '-qm', msg)
    for attempt in range(4):
        try:
            git(out, 'push', '-q', 'origin', 'HEAD:whiten-results')
            return
        except subprocess.CalledProcessError:
            time.sleep(3 + attempt * 3)
    raise RuntimeError('could not save the results')

if __name__ == '__main__':
    sys.exit(main())
