// সবমিলবে admin — 📸 ছবি দিয়ে খুঁজুন (lib/admin/photofind.tsx)
// A photo of a product at home → the picture-recognition AI (client/admin/recognize.ts, the same one that described
// every product picture) describes three views of it: the whole photo, the middle, and closer in → the server
// answers the closest products → the owner picks the right one and sets its stock (and price) right there, or adds it
// as a new product with this photo. Many photos at once are worked through one after another.
import { h, Fragment, paint } from '../jsx.js';
import { bn, postJson, whenReady } from '../dom.js';
import { embedImage } from './recognize.js';
import { upload } from './images.js';

void Fragment;
type Match = {
  id: number; name: string; sku: string; price: number; active: boolean; unit: string; variants: number; bundle: boolean;
  location: string; main: number; held: number; shelf: number; image: string; score: number;
};
type Found = { ok: true; verdict: 'sure' | 'maybe' | 'none'; matches: Match[]; known: number; canPrice: boolean } | { ok: false; error: string };
type Saved = { ok: boolean; error?: string; message?: string; product?: { shelf: number }; warn?: string; price?: number };

whenReady(() => {
  const root = document.querySelector<HTMLElement>('[data-photofind]');
  if (root) start(root);
});

/** the three views of a photo the AI looks at: whole, middle 70 %, middle 45 % (a hand or a table around matters less) */
async function views(file: File): Promise<string[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('image')); i.src = url; });
    const W = img.naturalWidth, H = img.naturalHeight;
    const out: string[] = [];
    for (const part of [1, 0.7, 0.45]) {
      const w = W * part, hh = H * part;
      const k = Math.min(1, 640 / Math.max(w, hh));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(hh * k));
      const x = c.getContext('2d')!;
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, (W - w) / 2, (H - hh) / 2, w, hh, 0, 0, c.width, c.height);
      const e = await embedImage(c.toDataURL('image/jpeg', 0.92), true);
      if (!e) throw new Error('ai');
      out.push(e);
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function start(root: HTMLElement): void {
  const status = root.querySelector<HTMLElement>('[data-pf-status]')!;
  const list = root.querySelector<HTMLElement>('[data-pf-list]')!;
  const canPrice = root.dataset.canPrice === '1';
  const queue: File[] = [];
  let busy = false;
  let first = true;

  const take = (files: FileList | null) => {
    for (const f of Array.from(files || [])) if (/^image\//.test(f.type) || !f.type) queue.push(f);
    void run();
  };
  for (const sel of ['[data-pf-camera]', '[data-pf-files]']) {
    const inp = root.querySelector<HTMLInputElement>(sel);
    inp?.addEventListener('change', () => { take(inp.files); inp.value = ''; });
  }

  async function run() {
    if (busy) return;
    busy = true;
    try {
      while (queue.length) {
        const file = queue.shift()!;
        paint(status, queue.length ? `🧠 খোঁজা হচ্ছে… আরও ${bn(queue.length)}টা ছবি বাকি` : '🧠 খোঁজা হচ্ছে…');
        await one(file);
      }
      paint(status, '');
    } finally { busy = false; }
  }

  async function one(file: File) {
    const preview = URL.createObjectURL(file);
    const body = <div className="pf-body"><p className="muted">{first ? '🧠 AI চালু হচ্ছে… প্রথমবার একটু সময় লাগে (~৮৮ MB একবারই নামে, পরে আর লাগবে না)' : '🧠 AI ছবিটা দেখছে…'}</p></div>;
    const card = <article className="pf-card"><img className="pf-photo" src={preview} alt="" />{body}</article>;
    list.prepend(card);
    let found: Found;
    try {
      const v = await views(file);
      first = false;
      found = (await postJson<Found>('/admin/api/photo-find', { views: v })).j;
    } catch {
      paint(body, <p className="warn">⚠️ এই ডিভাইসে AI চালানো গেল না। কম্পিউটারের Chrome থেকে, বা ফোনে Wi-Fi চালু করে আবার চেষ্টা করুন।</p>);
      return;
    }
    if (!found || !found.ok) { paint(body, <p className="warn">⚠️ {(found && !found.ok && found.error) || 'খোঁজা গেল না — আবার চেষ্টা করুন।'}</p>); return; }
    render(body, file, found);
  }

  function render(body: HTMLElement, file: File, f: Extract<Found, { ok: true }>) {
    const head = f.verdict === 'sure' ? <p className="pf-verdict ok">✅ পাওয়া গেছে — প্রথমটাই সবচেয়ে বেশি মিলেছে। মিলিয়ে দেখে "এটাই" চাপুন।</p>
      : f.verdict === 'maybe' ? <p className="pf-verdict maybe">🤔 কাছাকাছি কয়েকটা পাওয়া গেছে — ঠিকটা আছে কি না দেখে নিন। না থাকলে আরেক দিক থেকে আরেকটা ছবি তুলুন।</p>
        : <p className="pf-verdict none">❌ মনে হচ্ছে এই পণ্যটা ওয়েবসাইটে নেই। নিচেরগুলো দেখে নিশ্চিত হয়ে নতুন পণ্য হিসেবে তুলুন।</p>;
    const rows = f.matches.map((m, i) => row(m, i === 0 && f.verdict === 'sure'));
    const add = <button type="button" className="btn btn-ghost btn-sm" onClick={async (e: Event) => {
      const b = e.currentTarget as HTMLButtonElement;
      b.disabled = true; paint(b, '⏳ ছবি তোলা হচ্ছে…');
      // the new-product page opens in a new tab, before the upload finishes (a phone blocks a tab opened later)
      const tab = window.open('about:blank', '_blank');
      try {
        const up = await upload(file);
        if (tab) tab.location.href = `/admin/products/new?img=${up.id}`; else location.href = `/admin/products/new?img=${up.id}`;
        paint(b, '✔ নতুন পণ্যের পেজ খোলা হয়েছে');
      } catch {
        tab?.close();
        b.disabled = false; paint(b, '➕ নতুন পণ্য হিসেবে তুলুন (এই ছবিসহ)');
      }
    }}>➕ নতুন পণ্য হিসেবে তুলুন (এই ছবিসহ)</button>;
    paint(body, head, <div className="pf-matches">{rows}</div>, <p className="pf-add">{add}</p>);
  }

  function row(m: Match, open: boolean) {
    const box = <div className="pf-edit" hidden={!open}></div>;
    const pick = <button type="button" className="btn btn-sm" onClick={() => { box.hidden = !box.hidden; if (!box.hidden && !box.firstChild) editor(box, m); }}>✅ এটাই</button>;
    if (open) editor(box, m);
    return <div className={`pf-match ${open ? 'on' : ''}`}>
      <img src={m.image} alt="" loading="lazy" />
      <div className="pf-info">
        <b>{m.name}</b>
        <span className="small muted">SKU {m.sku || '—'} · ৳{bn(m.price)} · স্টক {bn(m.shelf)} {m.unit}{m.location ? ` · 📍 ${m.location}` : ''}{m.active ? '' : ' · বন্ধ'}</span>
        <span className={`pf-score ${m.score >= 72 ? 'hi' : m.score >= 50 ? 'mid' : 'lo'}`}>{bn(m.score)}% মিল</span>
      </div>
      <div className="pf-btns">{pick} <a className="btn btn-ghost btn-sm" href={`/admin/products/${m.id}`} target="_blank" rel="noopener">পেজ →</a></div>
      {box}
    </div>;
  }

  function editor(box: HTMLElement, m: Match) {
    if (m.variants || m.bundle) {
      paint(box, <p className="small">এই পণ্যের {m.bundle ? 'সেটের অংশ' : 'রং/সাইজ'} আছে — স্টক আর দাম <a href={`/admin/products/${m.id}`} target="_blank" rel="noopener">পণ্যের পেজ</a> থেকে দিন।</p>);
      return;
    }
    const qty = <input type="number" min="0" inputMode="numeric" value={String(m.shelf)} className="pf-qty" /> as HTMLInputElement;
    const price = canPrice ? <input type="number" min="0.5" max="2000" step="0.5" inputMode="decimal" value={String(m.price)} className="pf-price" /> as HTMLInputElement : null;
    const msg = <p className="small" role="status"></p>;
    const save = <button type="button" className="btn btn-sm" onClick={async () => {
      save.disabled = true;
      const out: string[] = [];
      let bad = '';
      const n = Number(qty.value);
      if (qty.value !== '' && n !== m.shelf) {
        const r = (await postJson<Saved>('/admin/api/stock-scan/save', { id: m.id, mode: 'count', qty: qty.value })).j;
        if (r.ok) { out.push(r.message || '✔'); if (r.product) m.shelf = r.product.shelf; if (r.warn) out.push(r.warn); } else bad = r.error || 'স্টক সেভ হয়নি।';
      }
      if (!bad && price && price.value !== '' && Number(price.value) !== m.price) {
        const r = (await postJson<Saved>('/admin/api/photo-find/price', { id: m.id, price: price.value })).j;
        if (r.ok) { out.push(r.message || '✔'); if (typeof r.price === 'number') { m.price = r.price; price.value = String(r.price); } } else bad = r.error || 'দাম সেভ হয়নি।';
      }
      save.disabled = false;
      paint(msg, bad ? <span className="warn">⚠️ {bad}</span> : out.length ? out.join(' · ') : '✔ কিছু বদলাতে হয়নি — সব ঠিক আছে');
    }}>💾 সেভ</button> as HTMLButtonElement;
    paint(box,
      <label className="pf-field">ঘরে আসলে কতগুলো আছে (গুনে) {qty} <small className="muted">{m.unit}</small></label>,
      price ? <label className="pf-field">বিক্রির দাম ৳ {price}</label> : null,
      save, msg);
  }
}
