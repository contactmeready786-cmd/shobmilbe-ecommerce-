// সবমিলবে admin — pictures: resizing and uploading, the picture fingerprint (finds the same photo again),
// profile pictures, image pickers, the product's numbered picture slots, and the watermark.
import { h, Fragment, paint } from '../jsx.js';
import { $, $all, bn, hit } from '../dom.js';
import { getJSON, show, toast } from './core.js';

void Fragment;
export type Fingerprint = { h: string; m: string };

// ---------- picture fingerprint (finds the same photo even if resized, re-saved, bordered or mirrored) ----------
// Always made from the small 420px copy, so new uploads and old pictures are measured the same way.
export function fingerprint(img: HTMLImageElement): Fingerprint | null {
  try {
    const W = img.naturalWidth || img.width;
    const H = img.naturalHeight || img.height;
    if (!W || !H) return null;
    // 1) find the real picture inside plain (white/single colour) borders, pixel-exact
    const sc = Math.min(1, 480 / Math.max(W, H));
    const w0 = Math.max(1, Math.round(W * sc));
    const h0 = Math.max(1, Math.round(H * sc));
    const c = document.createElement('canvas');
    c.width = w0;
    c.height = h0;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.fillStyle = '#fff';
    x.fillRect(0, 0, w0, h0);
    x.drawImage(img, 0, 0, w0, h0);
    const d = x.getImageData(0, 0, w0, h0).data;
    const bg = [0, 0, 0];
    for (const k of [0, w0 - 1, w0 * (h0 - 1), w0 * h0 - 1]) { bg[0] += d[k * 4] / 4; bg[1] += d[k * 4 + 1] / 4; bg[2] += d[k * 4 + 2] / 4; }
    let minX = w0;
    let minY = h0;
    let maxX = -1;
    let maxY = -1;
    for (let yy = 0; yy < h0; yy++) {
      for (let xx = 0; xx < w0; xx++) {
        const k = (yy * w0 + xx) * 4;
        if (Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 60) {
          if (xx < minX) minX = xx;
          if (xx > maxX) maxX = xx;
          if (yy < minY) minY = yy;
          if (yy > maxY) maxY = yy;
        }
      }
    }
    if (maxX < 0 || maxX - minX < 4 || maxY - minY < 4) return { h: '', m: '' }; // plain picture: nothing to compare
    const sx = minX / sc;
    const sy = minY / sc;
    const sw = (maxX + 1 - minX) / sc;
    const sh = (maxY + 1 - minY) / sc;
    // 2) shrink to 32 x 32 grey squares (each the average of 4 x 4 pixels)
    const c2 = document.createElement('canvas');
    c2.width = 128;
    c2.height = 128;
    const x2 = c2.getContext('2d', { willReadFrequently: true })!;
    x2.imageSmoothingQuality = 'high';
    x2.fillStyle = '#fff';
    x2.fillRect(0, 0, 128, 128);
    x2.drawImage(img, sx, sy, sw, sh, 0, 0, 128, 128);
    const p = x2.getImageData(0, 0, 128, 128).data;
    const N = 32;
    const K = 16;
    const G: number[] = [];
    let lo = 1e9;
    let hi = -1e9;
    for (let r = 0; r < N; r++) {
      for (let cc = 0; cc < N; cc++) {
        let sum = 0;
        for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
          const q = ((r * 4 + by) * 128 + cc * 4 + bx) * 4;
          sum += p[q] * 0.299 + p[q + 1] * 0.587 + p[q + 2] * 0.114;
        }
        const v = sum / 16;
        G.push(v);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (hi - lo < 10) return { h: '', m: '' };
    // 3) the picture's 16 x 16 coarsest patterns (DCT, like JPEG uses).
    //    Each of the 256 bits: is this pattern stronger than the middle value?
    const cos: number[][] = [];
    for (let kk = 0; kk < K; kk++) { cos.push([]); for (let n = 0; n < N; n++) cos[kk].push(Math.cos(((2 * n + 1) * kk * Math.PI) / (2 * N))); }
    const rowT: number[] = [];
    for (let r1 = 0; r1 < N; r1++) for (let u = 0; u < K; u++) {
      let t = 0;
      for (let n1 = 0; n1 < N; n1++) t += G[r1 * N + n1] * cos[u][n1];
      rowT[r1 * K + u] = t;
    }
    const D: number[] = [];
    for (let vv = 0; vv < K; vv++) for (let u2 = 0; u2 < K; u2++) {
      let t2 = 0;
      for (let r2 = 0; r2 < N; r2++) t2 += rowT[r2 * K + u2] * cos[vv][r2];
      D.push(t2);
    }
    const M = D.map((val, i) => ((i % K) % 2 ? -val : val)); // mirror image: odd left-right patterns flip sign
    const bitsOf = (arr: number[]) => {
      const rest = arr.slice(1).sort((a2, b2) => a2 - b2);
      const med = rest[Math.floor(rest.length / 2)];
      return arr.map((v, i) => (i === 0 ? '0' : v > med ? '1' : '0')).join('');
    };
    const hex = (bb: string) => { let o = ''; for (let i = 0; i < bb.length; i += 4) o += parseInt(bb.slice(i, i + 4), 2).toString(16); return o; };
    return { h: hex(bitsOf(D)), m: hex(bitsOf(M)) };
  } catch { return null; }
}
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('bad image'));
    // pictures on ImageKit are fetched through this site, so the browser may read their pixels (fingerprint, watermark)
    im.src = /^\/media\//.test(src) ? `${src}${src.includes('?') ? '&' : '?'}raw=1` : src;
  });
}

// ---------- image resizing & upload ----------
type Resized = { data: string; width: number; height: number; png: boolean };
function resize(file: Blob, max: number, quality: number, square?: boolean): Promise<Resized> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('bad image'));
      img.onload = () => {
        // square: the middle of the picture, cut to a square (profile pictures)
        const side = Math.min(img.width, img.height);
        const sx = square ? Math.round((img.width - side) / 2) : 0;
        const sy = square ? Math.round((img.height - side) / 2) : 0;
        const sw = square ? side : img.width;
        const sh = square ? side : img.height;
        const scale = Math.min(1, max / Math.max(sw, sh));
        const w = Math.round(sw * scale);
        const hh = Math.round(sh * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = hh;
        const ctx = canvas.getContext('2d')!;
        const png = !square && (file.type === 'image/png' || file.type === 'image/webp');
        if (!png) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh); }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, hh);
        resolve({ data: png ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality), width: w, height: hh, png });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
export type UploadOpts = { max?: number; thumb?: number; square?: boolean; import?: boolean; private?: boolean };
/** what POST /admin/api/media answers for a saved picture (lib/admin/index.tsx) */
export type Uploaded = { id: number; url: string; thumb: string };
export async function upload(file: Blob, opts: UploadOpts = {}): Promise<Uploaded> {
  const max = opts.max || 1200;
  let full = await resize(file, max, 0.82, opts.square);
  // Big PNGs (photos saved as PNG) become JPEG to stay small.
  if (full.png && full.data.length > 900000) full = await resize(new File([file], 'x.jpg', { type: 'image/jpeg' }), max, 0.82, opts.square);
  const th = await resize(file, opts.thumb || 420, 0.78, opts.square);
  const fp = await loadImage(th.data).then(fingerprint, () => null);
  const r = await fetch('/admin/api/media', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: full.data, thumb: th.data, width: full.width, height: full.height,
      phash: fp ? fp.h : undefined, phash_m: fp ? fp.m : undefined, import: opts.import ? 1 : undefined, private: opts.private ? 1 : undefined }),
  });
  const j = (await r.json()) as Uploaded & { error?: string };
  if (!r.ok) throw new Error(j.error || 'আপলোড হয়নি');
  return j;
}

// 📸 take a photo with the device camera: live picture → "ছবি তুলুন" → look → "এই ছবি নিন" / "আবার তুলুন".
// Resolves with a JPEG File (or null if closed).
function cameraShot(title?: string): Promise<File | null> {
  return new Promise((resolve, reject) => {
    if (!navigator.mediaDevices?.getUserMedia) { reject(new Error('এই ব্রাউজারে ক্যামেরা চালানো যায় না — "ছবি দিন" দিয়ে ছবি বেছে নিন।')); return; }
    const video = <video playsinline="" muted="" autoplay="" /> as HTMLVideoElement;
    const img = <img alt="" hidden /> as HTMLImageElement;
    const sayEl = <p className="small muted" data-cam-say="">⏳ ক্যামেরা চালু হচ্ছে…</p>;
    const snap = <button type="button" className="btn" data-cam-snap="" disabled>📸 ছবি তুলুন</button> as HTMLButtonElement;
    const live = <div className="cam-btns" data-cam-live="">{snap}<button type="button" className="btn btn-ghost" data-cam-close="">বাতিল</button></div>;
    const doneRow = <div className="cam-btns" data-cam-done="" hidden><button type="button" className="btn" data-cam-use="">✅ এই ছবি নিন</button><button type="button" className="btn btn-ghost" data-cam-retake="">🔁 আবার তুলুন</button></div>;
    const m = <div className="cam-modal"><div className="cam-card" role="dialog" aria-modal="true"><h3>{title || '📸 ক্যামেরায় ছবি তুলুন'}</h3><div className="cam-view">{video}{img}</div>{sayEl}{live}{doneRow}</div></div>;
    document.body.appendChild(m);
    let stream: MediaStream | null = null;
    let blob: Blob | null = null;
    const stop = () => { for (const t of stream?.getTracks() || []) t.stop(); stream = null; };
    const close = (f: File | null) => { stop(); m.remove(); resolve(f); };
    const start = async () => {
      blob = null;
      show(img, false); show(video, true); show(doneRow, false); show(live, true);
      sayEl.textContent = '⏳ ক্যামেরা চালু হচ্ছে…';
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
        video.srcObject = stream;
        await video.play().catch(() => {});
        snap.disabled = false;
        sayEl.textContent = 'মুখ মাঝখানে রেখে "📸 ছবি তুলুন" চাপুন';
      } catch (e) {
        const n = (e as DOMException)?.name;
        sayEl.textContent = n === 'NotAllowedError' ? '❌ ক্যামেরার অনুমতি দেওয়া হয়নি। ঠিকানার পাশের 🔒 চিহ্নে চাপ দিয়ে Camera "Allow" করুন।' : n === 'NotFoundError' ? '❌ কোনো ক্যামেরা পাওয়া যায়নি।' : '❌ ক্যামেরা চালু করা যায়নি।';
      }
    };
    snap.addEventListener('click', () => {
      if (!stream || !video.videoWidth) return;
      const side = Math.min(video.videoWidth, video.videoHeight);
      const c = document.createElement('canvas');
      c.width = c.height = Math.min(side, 720);
      const g = c.getContext('2d')!;
      g.translate(c.width, 0);
      g.scale(-1, 1); // same as the mirror view the person saw
      g.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, c.width, c.height);
      c.toBlob((b) => {
        if (!b) return;
        blob = b;
        img.src = URL.createObjectURL(b);
        stop();
        show(video, false); show(img, true); show(live, false); show(doneRow, true);
        sayEl.textContent = 'ছবিটা ঠিক আছে?';
      }, 'image/jpeg', 0.9);
    });
    $('[data-cam-retake]', m)!.addEventListener('click', () => void start());
    $('[data-cam-use]', m)!.addEventListener('click', () => close(blob ? new File([blob], 'camera.jpg', { type: 'image/jpeg' }) : null));
    $('[data-cam-close]', m)!.addEventListener('click', () => close(null));
    m.addEventListener('click', (e) => { if (e.target === m) close(null); });
    void start();
  });
}

// profile picture (owner and staff): pick or take a photo, then "সেভ করুন"; "মুছুন" removes it
function avatars(): void {
  for (const box of $all('[data-avatar-pick]')) {
    const file = $<HTMLInputElement>('[data-avatar-file]', box);
    const msg = $('[data-avatar-msg]', box);
    const action = box.getAttribute('data-action') || '';
    const say = (text: string, cls: string) => { if (msg) { msg.textContent = text; msg.className = cls; } };
    const save = async (id: string | number) => {
      const r = await fetch(action, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ photo_id: id }) });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error || 'সেভ হয়নি');
      return j;
    };
    const busy = (on: boolean, text = '') => { box.classList.toggle('busy', on); say(text, 'small muted'); };
    const fail = (e: Error) => { box.classList.remove('busy'); say(e.message, 'small warn'); };
    // a chosen or camera picture is only shown first; "💾 সেভ করুন" saves it, "বাতিল" puts the old one back
    const confirmRow = $('[data-avatar-confirm]', box);
    let pending: File | null = null;
    let old: Element | null = null;
    const preview = (f: File) => {
      pending = f;
      const el = box.querySelector('.avatar.avatar-xl');
      if (el) {
        if (!old) old = el;
        el.replaceWith(<span className="avatar has-photo avatar-xl avatar-preview"><img src={URL.createObjectURL(f)} alt="" /></span>);
      }
      show(confirmRow, true);
      say('👀 নতুন ছবি দেখাচ্ছে — রাখতে "💾 সেভ করুন" চাপুন', 'small warn');
    };
    const cancel = () => {
      pending = null;
      show(confirmRow, false);
      const el = box.querySelector('.avatar-preview');
      if (el && old) { el.replaceWith(old); old = null; }
      say('বাতিল করা হয়েছে — আগের ছবিই আছে।', 'small muted');
    };
    file?.addEventListener('change', () => { const f = file.files?.[0]; if (f) preview(f); file.value = ''; });
    $('[data-avatar-camera]', box)?.addEventListener('click', () => { cameraShot().then((f) => { if (f) preview(f); }, fail); });
    const saveBtn = $<HTMLButtonElement>('[data-avatar-save]', box);
    saveBtn?.addEventListener('click', async () => {
      if (!pending) return;
      saveBtn.disabled = true;
      busy(true, 'ছবি আপলোড হচ্ছে…');
      try {
        const j = await upload(pending, { max: 600, thumb: 160, square: true, private: true });
        await save(j.id);
        busy(true, '✅ ছবি সেভ হয়েছে');
        location.reload();
      } catch (e) { saveBtn.disabled = false; fail(e as Error); }
    });
    $('[data-avatar-cancel]', box)?.addEventListener('click', cancel);
    $('[data-avatar-remove]', box)?.addEventListener('click', () => {
      if (!confirm('প্রোফাইল ছবি মুছে ফেলবেন?')) return;
      busy(true, 'মুছছে…');
      save('').then(() => location.reload(), fail);
    });
  }
}

// After a picture is added or removed: say so clearly, and point at the form's save button.
function pickStatus(box: Element, what: 'added' | 'removed'): void {
  const st = $('[data-pick-status]', box);
  if (st) {
    st.className = `pick-status ${what === 'added' ? 'is-added' : 'is-removed'}`;
    st.textContent = what === 'added' ? '✅ ছবি যোগ হয়েছে — সাইটে দেখাতে নিচের "সেভ করুন" চাপুন' : '🗑️ ছবি সরানো হবে — নিশ্চিত করতে "সেভ করুন" চাপুন';
  }
  const form = box.closest('form');
  if (!form) return;
  const save = $('.form-actions button, button[type="submit"], .btn-lg', form);
  if (save) {
    save.classList.add('needs-save');
    if (!save.getAttribute('data-orig')) save.setAttribute('data-orig', save.textContent || '');
    save.textContent = '💾 সেভ করুন (পরিবর্তন সেভ হয়নি)';
  }
  form.setAttribute('data-dirty', '1');
}
/** 🏷️ A logo is cut down to its drawing: empty edges (see-through, or one plain colour such as white) are removed, so
 *  every logo fills the same space in the header and footer as the shop name written in text — whatever size it was made at.
 *  Returns a PNG (see-through stays see-through); the original file when there is nothing to cut or it can't be read. */
export function trimLogo(file: File): Promise<File> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const w = img.naturalWidth, hh = img.naturalHeight;
        if (!w || !hh) { resolve(file); return; }
        const c = document.createElement('canvas');
        c.width = w; c.height = hh;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, w, hh).data;
        // the background: the top-left corner (see-through, or a plain colour)
        const [br, bg, bb, ba] = [px[0], px[1], px[2], px[3]];
        const plainBg = ba >= 16;
        const blank = (i: number) => px[i + 3] < 16
          || (plainBg && Math.abs(px[i] - br) < 24 && Math.abs(px[i + 1] - bg) < 24 && Math.abs(px[i + 2] - bb) < 24);
        let top = hh, left = w, right = -1, bottom = -1;
        for (let y = 0; y < hh; y++) {
          for (let x = 0; x < w; x++) {
            if (blank((y * w + x) * 4)) continue;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
            if (x < left) left = x;
            if (x > right) right = x;
          }
        }
        if (right < 0) { resolve(file); return; } // nothing drawn at all
        // keep a hair of room so no letter touches the edge
        const pad = Math.round(Math.max(right - left, bottom - top) * 0.01);
        left = Math.max(0, left - pad); top = Math.max(0, top - pad);
        right = Math.min(w - 1, right + pad); bottom = Math.min(hh - 1, bottom + pad);
        const cw = right - left + 1, ch = bottom - top + 1;
        if (cw === w && ch === hh) { resolve(file); return; }
        const out = document.createElement('canvas');
        out.width = cw; out.height = ch;
        out.getContext('2d')!.drawImage(c, left, top, cw, ch, 0, 0, cw, ch);
        out.toBlob((b) => resolve(b ? new File([b], 'logo.png', { type: 'image/png' }) : file), 'image/png');
      } catch { resolve(file); }
    };
    img.src = url;
  });
}

function imagePickers(): void {
  for (const box of $all('[data-image-pick]')) {
    const file = $<HTMLInputElement>('[data-pick-file]', box)!;
    const value = $<HTMLInputElement>('[data-pick-value]', box)!;
    const preview = $('[data-pick-preview]', box)!;
    const clear = $('[data-pick-clear]', box);
    const form = box.closest('form');
    file.addEventListener('change', async () => {
      let f = file.files?.[0];
      if (!f) return;
      // the header logo: empty edges cut away, so it sits in the header and footer exactly like the shop name does
      if (value.name === 'logo_id') f = await trimLogo(f);
      const btns = form ? $all<HTMLButtonElement>('button', form) : [];
      for (const b of btns) b.disabled = true;
      paint(preview, <span className="muted small">আপলোড হচ্ছে…</span>);
      try {
        const j = await upload(f, { max: file.hasAttribute('data-wide') ? 1800 : 1000 });
        value.value = String(j.id);
        paint(preview, <img src={j.thumb} alt="" />);
        if (clear) clear.hidden = false;
        pickStatus(box, 'added');
      } catch (e) { paint(preview, <span className="warn small">{(e as Error).message}</span>); }
      for (const b of btns) b.disabled = false;
      file.value = '';
    });
    clear?.addEventListener('click', () => { value.value = ''; paint(preview, <span className="muted small">ছবি নেই</span>); clear.hidden = true; pickStatus(box, 'removed'); });
  }
}

// product images: fixed numbered slots (slot 1 = main image)
function slots(): void {
  const slotsBox = $('[data-slots]');
  if (!slotsBox) return;
  const slotsValue = $<HTMLInputElement>('[data-slots-value]')!;
  const slots = $all('[data-slot]', slotsBox);
  const saveBtn = $<HTMLButtonElement>('[data-save]');
  let busy = 0;
  const label = (i: number) => (i === 0 ? 'মূল ছবি' : `ছবি ${bn(i + 1)}`);
  const clearShown = (add: Element) => { for (const n of $all('img, .slot-plus, .slot-hint, .slot-wait', add)) n.remove(); };
  const draw = (slot: HTMLElement, id: string | number | null, src?: string) => {
    const i = Number(slot.getAttribute('data-slot'));
    const add = $('.slot-add', slot)!;
    const file = $('[data-slot-file]', slot)!;
    slot.setAttribute('data-img', String(id || ''));
    slot.classList.toggle('filled', !!id);
    slot.classList.remove('busy');
    // keep the file input, replace what is shown
    clearShown(add);
    if (id) file.before(<img src={src || `/media/${id}/t`} alt={label(i)} />);
    else add.prepend(<span className="slot-plus" aria-hidden="true">＋</span>, <span className="slot-hint">ছবি যোগ করুন</span>);
    const tools = $('.g-tools', slot);
    if (tools) tools.hidden = !id;
  };
  let lastImgs: string | null = null;
  const sync = () => {
    slotsValue.value = slots.map((sl) => sl.getAttribute('data-img')).filter(Boolean).join(',');
    if (saveBtn) saveBtn.disabled = busy > 0;
    if (busy === 0 && lastImgs !== null && lastImgs !== slotsValue.value) document.dispatchEvent(new Event('sm:images'));
    if (busy === 0) lastImgs = slotsValue.value;
  };
  const putFile = async (slot: HTMLElement, f: File) => {
    if (!/^image\//.test(f.type)) { toast('শুধু ছবি (JPG, PNG, WEBP) দিন।'); return; }
    const add = $('.slot-add', slot)!;
    clearShown(add);
    add.prepend(<span className="slot-wait">আপলোড হচ্ছে…</span>);
    slot.classList.add('busy');
    busy++;
    sync();
    const prev = slot.getAttribute('data-img');
    try { const j = await upload(f, { max: 1200 }); draw(slot, j.id, j.thumb); } catch (e) { draw(slot, prev); toast((e as Error).message); }
    busy--;
    sync();
  };
  for (const slot of slots) {
    const file = $<HTMLInputElement>('[data-slot-file]', slot)!;
    file.addEventListener('change', () => {
      const files = Array.from(file.files || []);
      file.value = '';
      if (!files.length) return;
      void putFile(slot, files[0]);
      // several photos picked at once: fill the next empty slots too
      const start = slots.indexOf(slot);
      for (const f of files.slice(1)) {
        const next = slots.find((s2, k) => k > start && !s2.getAttribute('data-img') && !s2.classList.contains('busy'));
        if (next) void putFile(next, f);
      }
    });
  }
  slotsBox.addEventListener('click', (e) => {
    const slot = hit(e, '[data-slot]');
    if (!slot || slot.classList.contains('busy')) return;
    if (hit(e, '[data-slot-del]')) { draw(slot, ''); sync(); return; }
    if (hit(e, '[data-slot-change]')) { $('[data-slot-file]', slot)?.click(); return; }
    const mv = hit(e, '[data-slot-move]');
    if (!mv) return;
    const i = slots.indexOf(slot);
    const j = i + Number(mv.getAttribute('data-slot-move'));
    if (j < 0 || j >= slots.length || slots[j].classList.contains('busy')) return;
    const a = slot.getAttribute('data-img');
    const bId = slots[j].getAttribute('data-img');
    const aSrc = a ? $<HTMLImageElement>('img', slot)?.src : '';
    const bSrc = bId ? $<HTMLImageElement>('img', slots[j])?.src : '';
    draw(slot, bId, bSrc);
    draw(slots[j], a, aSrc);
    sync();
  });
  sync();
}

// ---------- fingerprints for older product pictures (runs quietly on product pages) ----------
function oldFingerprints(): void {
  if (!/^\/admin\/products/.test(location.pathname)) return;
  const fpStatus = $('[data-fp-status]');
  let made = 0;
  let rounds = 0;
  const round = async (): Promise<void> => {
    if (rounds++ > 40) return;
    try {
      const j = await getJSON<{ ids?: number[] }>('/admin/api/media/fingerprints');
      const ids = j.ids || [];
      if (!ids.length) {
        if (fpStatus && made) { fpStatus.hidden = false; paint(fpStatus, `✅ পুরোনো ${bn(made)}টি ছবির ছাপ তৈরি হয়েছে। `, <a href="">পেজটা আবার লোড করুন</a>, ' — ছবি দিয়েও ডুপ্লিকেট খোঁজা হবে।'); }
        return;
      }
      if (fpStatus) { fpStatus.hidden = false; fpStatus.textContent = `⏳ পুরোনো ছবির ছাপ তৈরি হচ্ছে… (${bn(made)}টি হয়েছে) — এই পেজটা খোলা রাখুন।`; }
      const items = await Promise.all(ids.map((id) => loadImage(`/media/${id}/t`).then((im) => {
        const fp = fingerprint(im);
        return { id, phash: fp ? fp.h : '', phash_m: fp ? fp.m : '' };
      }, () => ({ id, phash: '', phash_m: '' }))));
      made += items.length;
      await fetch('/admin/api/media/fingerprints', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
      setTimeout(round, 300);
    } catch { /* try again next time a product page opens */ }
  };
  setTimeout(round, 1500);
}

// ---------- watermark (ওয়াটারমার্ক) ----------
// Finds the product on its (white) background and blends the mark into the product itself:
// on light parts it darkens a little, on dark parts it lightens a little, and on the plain
// background it is much fainter — so it looks printed on the product.
type WmCfg = { type: string; text?: string; logo?: number | null; strength: string; size: string; place: string; ver?: string };
const WM_ALPHA: Record<string, number> = { soft: 0.12, normal: 0.2, clear: 0.32 };
const WM_SIZE: Record<string, number> = { s: 0.28, m: 0.4, l: 0.55 };
function drawWatermark(img: HTMLImageElement, cfg: WmCfg, logo: HTMLImageElement | null): HTMLCanvasElement {
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = '#fff';
  x.fillRect(0, 0, W, H);
  x.drawImage(img, 0, 0, W, H);
  // 1) where is the product?
  const sc = Math.min(1, 220 / Math.max(W, H));
  const sw = Math.max(1, Math.round(W * sc));
  const sh = Math.max(1, Math.round(H * sc));
  const s = document.createElement('canvas');
  s.width = sw;
  s.height = sh;
  const sx = s.getContext('2d', { willReadFrequently: true })!;
  sx.drawImage(c, 0, 0, sw, sh);
  const d = sx.getImageData(0, 0, sw, sh).data;
  const bg = [0, 0, 0];
  for (const k of [0, sw - 1, sw * (sh - 1), sw * sh - 1]) { bg[0] += d[k * 4] / 4; bg[1] += d[k * 4 + 1] / 4; bg[2] += d[k * 4 + 2] / 4; }
  const isProd = (r: number, g: number, b: number) => Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 54;
  const cols = new Array<number>(sw).fill(0);
  const rows = new Array<number>(sh).fill(0);
  for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) { const k = (yy * sw + xx) * 4; if (isProd(d[k], d[k + 1], d[k + 2])) { cols[xx]++; rows[yy]++; } }
  const edge = (arr: number[], min: number) => { let a = 0; let b = arr.length - 1; while (a < b && arr[a] < min) a++; while (b > a && arr[b] < min) b--; return [a, b]; };
  const cx2 = edge(cols, Math.max(1, sh * 0.02));
  const ry2 = edge(rows, Math.max(1, sw * 0.02));
  let box = { x: cx2[0] / sc, y: ry2[0] / sc, w: (cx2[1] - cx2[0] + 1) / sc, h: (ry2[1] - ry2[0] + 1) / sc };
  if (box.w < W * 0.12 || box.h < H * 0.12) box = { x: 0, y: 0, w: W, h: H };
  if (cfg.place === 'center') box = { x: 0, y: 0, w: W, h: H };
  // 2) draw the mark (white on transparent) at the right size
  let mw = Math.max(60, Math.min(box.w * (WM_SIZE[cfg.size] || 0.4), W * 0.7));
  let mh: number;
  const m = document.createElement('canvas');
  const useLogo = cfg.type === 'logo' && !!logo;
  const font = (px: number) => `800 ${px}px "Noto Sans Bengali", "Hind Siliguri", system-ui, sans-serif`;
  let fs = 0;
  const text = String(cfg.text || '').trim() || 'shobmilbe.com';
  if (useLogo && logo) {
    const lw = logo.naturalWidth || logo.width;
    const lh = logo.naturalHeight || logo.height;
    mh = (mw * lh) / lw;
    if (mh > box.h * 0.4) { mh = box.h * 0.4; mw = (mh * lw) / lh; }
  } else {
    const t = document.createElement('canvas').getContext('2d')!;
    t.font = font(100);
    fs = (100 * mw) / Math.max(1, t.measureText(text).width);
    fs = Math.max(12, Math.min(fs, box.h * 0.2, H * 0.12));
    t.font = font(fs);
    mw = Math.ceil(t.measureText(text).width) + 4;
    mh = Math.ceil(fs * 1.35);
  }
  mw = Math.round(mw);
  mh = Math.round(mh);
  m.width = mw;
  m.height = mh;
  const mx = m.getContext('2d', { willReadFrequently: true })!;
  if (useLogo && logo) mx.drawImage(logo, 0, 0, mw, mh);
  else { mx.font = font(fs); mx.fillStyle = '#fff'; mx.textBaseline = 'middle'; mx.textAlign = 'center'; mx.fillText(text, mw / 2, mh / 2); }
  const md = mx.getImageData(0, 0, mw, mh).data;
  // a logo on a plain (non-transparent) background: only its darker drawing counts
  const opaque = useLogo && md[3] > 250 && md[(mw - 1) * 4 + 3] > 250 && md[(mw * mh - 1) * 4 + 3] > 250;
  // 3) where it goes
  let cx: number;
  let cy: number;
  if (cfg.place === 'corner') { cx = box.x + box.w - mw / 2 - box.w * 0.06; cy = box.y + box.h - mh / 2 - box.h * 0.07; }
  else { cx = box.x + box.w / 2; cy = box.y + box.h * (cfg.place === 'center' ? 0.5 : 0.6); }
  const ox = Math.round(Math.max(0, Math.min(W - mw, cx - mw / 2)));
  const oy = Math.round(Math.max(0, Math.min(H - mh, cy - mh / 2)));
  const rw = Math.min(mw, W - ox);
  const rh = Math.min(mh, H - oy);
  const area = x.getImageData(ox, oy, rw, rh);
  const p = area.data;
  const a = WM_ALPHA[cfg.strength] || 0.2;
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
    const mk = (j * mw + i) * 4;
    const pk = (j * rw + i) * 4;
    let cov = md[mk + 3] / 255;
    if (opaque) cov = 1 - (md[mk] * 0.3 + md[mk + 1] * 0.59 + md[mk + 2] * 0.11) / 255;
    if (cov <= 0) continue;
    const r = p[pk];
    const g = p[pk + 1];
    const b = p[pk + 2];
    const k2 = cov * a * (isProd(r, g, b) ? 1 : 0.35);
    const lum = r * 0.3 + g * 0.59 + b * 0.11;
    if (lum > 140) { p[pk] = r * (1 - k2 * 0.85); p[pk + 1] = g * (1 - k2 * 0.85); p[pk + 2] = b * (1 - k2 * 0.85); }
    else { p[pk] = r + (255 - r) * k2; p[pk + 1] = g + (255 - g) * k2; p[pk + 2] = b + (255 - b) * k2; }
  }
  x.putImageData(area, ox, oy);
  return c;
}
const wmLogos = new Map<number, Promise<HTMLImageElement | null>>();
function wmLogo(cfg: WmCfg): Promise<HTMLImageElement | null> {
  if (cfg.type !== 'logo' || !cfg.logo) return Promise.resolve(null);
  if (!wmLogos.has(cfg.logo)) wmLogos.set(cfg.logo, loadImage(`/media/${cfg.logo}`).catch(() => null));
  return wmLogos.get(cfg.logo)!;
}
const fontsReady = () => (document.fonts?.ready ? document.fonts.ready.then(() => undefined, () => undefined) : Promise.resolve());

function watermark(): void {
  // settings page: live sample
  const wmForm = $<HTMLFormElement>('[data-wm-form]');
  if (wmForm) {
    const cv = $<HTMLCanvasElement>('[data-wm-preview]');
    let src: Promise<HTMLImageElement> | null = null;
    const v = (n: string) => (wmForm.elements.namedItem(n) as HTMLInputElement | null)?.value || '';
    const current = (): WmCfg => {
      const type = wmForm.querySelector<HTMLInputElement>('[name=wm_type]:checked')?.value || 'domain';
      return { type, text: type === 'text' ? v('wm_text') : $<HTMLInputElement>('[data-wm-domain]')?.value, logo: Number(v('wm_logo_id')) || Number($<HTMLInputElement>('[data-wm-store-logo]')?.value) || null,
        strength: v('wm_strength'), size: v('wm_size'), place: v('wm_place') };
    };
    const render = async () => {
      for (const el of $all('[data-wm-show]', wmForm)) el.hidden = el.getAttribute('data-wm-show') !== current().type;
      if (!cv) return;
      const cfg = current();
      try {
        const [im, logo] = await Promise.all([src || (src = loadImage(cv.getAttribute('data-src') || '')), wmLogo(cfg), fontsReady()]);
        const out = drawWatermark(im, cfg, logo);
        cv.width = out.width;
        cv.height = out.height;
        cv.getContext('2d')?.drawImage(out, 0, 0);
      } catch { /* no sample */ }
    };
    wmForm.addEventListener('input', () => void render());
    wmForm.addEventListener('change', () => setTimeout(render, 50));
    // the logo picker fills a hidden box without an input event
    const lv = wmForm.querySelector<HTMLInputElement>('[name=wm_logo_id]');
    if (lv) { let last = lv.value; setInterval(() => { if (lv.value !== last) { last = lv.value; void render(); } }, 700); }
    cv?.addEventListener('click', () => cv.parentElement?.classList.toggle('big'));
    void render();
  }
  // every admin page: quietly mark product pictures that are new or were made with older settings
  if (!/^\/admin/.test(location.pathname)) return;
  const prog = $('[data-wm-progress]');
  let done = prog ? Number(prog.getAttribute('data-done')) : 0;
  const total = prog ? Number(prog.getAttribute('data-total')) : 0;
  let rounds = 0;
  const post = (id: number, body: unknown) => fetch(`/admin/api/watermark/${id}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const round = async (): Promise<void> => {
    if (rounds++ > 300) return;
    try {
      const j = await getJSON<{ ids?: number[]; cfg: WmCfg }>('/admin/api/watermark/pending');
      const ids = j.ids || [];
      if (!ids.length) { if (prog && j.cfg && rounds > 1) prog.textContent = `✅ সব ছবিতে ওয়াটারমার্ক বসেছে (${bn(total)}টি)।`; return; }
      const cfg = j.cfg;
      const [logo] = await Promise.all([wmLogo(cfg), fontsReady()]);
      for (const id of ids) {
        try {
          const im = await loadImage(`/media/${id}?fresh=${Date.now()}`); // always today's picture, never a copy the browser kept
          await post(id, { ver: cfg.ver, data: drawWatermark(im, cfg, logo).toDataURL('image/jpeg', 0.9) });
        } catch {
          // a picture that can't be read: note it, so it is not tried again and again
          await post(id, { ver: cfg.ver, skip: 1 }).catch(() => undefined);
        }
        done++;
        if (prog) prog.textContent = `⏳ ${bn(Math.min(done, total))} / ${bn(total)} টি ছবিতে ওয়াটারমার্ক বসেছে — পেজটা খোলা রাখুন।`;
      }
      setTimeout(round, 200);
    } catch { /* try again next time an admin page opens */ }
  };
  setTimeout(round, prog ? 300 : 2500);
}

export function startImages(): void {
  for (const [name, start] of [['avatars', avatars], ['pickers', imagePickers], ['slots', slots], ['fingerprints', oldFingerprints], ['watermark', watermark]] as [string, () => void][]) {
    try { start(); } catch (e) { console.error(`সবমিলবে admin: ${name} could not start`, e); }
  }
}
