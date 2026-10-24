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
    """Keep the product: drop small separate pieces, and pieces that look like a shop's logo / banner / text line —
    smaller than the product and sitting in a corner / along the top or bottom edge, or long and thin."""
    lab, n = ndimage.label(m > 0.1)
    if n <= 1:
        return m
    idx = np.arange(1, n + 1)
    area = ndimage.sum(np.ones_like(m), lab, idx)
    big = area.max()
    objs = ndimage.find_objects(lab)
    keep = np.zeros(n + 1, dtype=bool)
    for i, (a, sl) in enumerate(zip(area, objs), start=1):
        if a < big * 0.12:
            continue  # small stray piece
        ys, xs = sl
        h, w = ys.stop - ys.start, xs.stop - xs.start
        edge = ys.stop <= S * 0.24 or ys.start >= S * 0.76  # wholly in the top or bottom band
        corner = (xs.stop <= S * 0.3 or xs.start >= S * 0.7) and (ys.stop <= S * 0.35 or ys.start >= S * 0.65)
        thin = w > h * 5 or h > w * 5
        if a < big * 0.45 and (edge or corner or thin):
            continue  # a logo / banner / text line, not the product
        keep[i] = True
    keep[np.argmax(area) + 1] = True  # the biggest piece is always the product
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


def git(out, *args):
    subprocess.run(['git', '-C', out, *args], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shop', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--vendor', default='public/vendor/birefnet')
    ap.add_argument('--minutes', type=float, default=9)
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
    os.makedirs(os.path.join(args.out, 'results'), exist_ok=True)
    idx_path = os.path.join(args.out, 'results', 'index.json')
    index = json.load(open(idx_path)) if os.path.exists(idx_path) else {}
    sess = None
    stop_at = time.time() + args.minutes * 60
    while time.time() < stop_at:
        try:
            jobs = json.loads(fetch(args.shop.rstrip('/') + '/api/whiten-jobs').decode()).get('jobs', [])
        except Exception as e:
            print('jobs list failed:', e)
            jobs = []
        jobs = [j for j in jobs if j['token'] not in index]
        if not jobs:
            time.sleep(20)
            continue
        if sess is None:
            sess = load_model(args.vendor)
        for j in jobs:
            t0 = time.time()
            try:
                jpg = whiten(sess, fetch(j['src']), j.get('opts') or {})
                open(os.path.join(args.out, 'results', j['token'] + '.jpg'), 'wb').write(jpg)
                index[j['token']] = {'ok': True}
                print(f"job {j['id']}: done in {time.time() - t0:.1f}s ({len(jpg) // 1024} KB)")
            except Exception as e:
                index[j['token']] = {'ok': False, 'error': str(e)[:200]}
                print(f"job {j['id']}: failed: {e}")
        json.dump(index, open(idx_path, 'w'))
        git(args.out, 'add', '-A')
        git(args.out, '-c', 'user.name=whiten-cloud', '-c', 'user.email=actions@github.com', 'commit', '-qm', f'whiten: {len(jobs)} picture(s)')
        git(args.out, 'push', '-q', 'origin', 'HEAD:whiten-results')
        stop_at = max(stop_at, time.time() + 4 * 60)  # more may come: keep watching a little longer


if __name__ == '__main__':
    sys.exit(main())
