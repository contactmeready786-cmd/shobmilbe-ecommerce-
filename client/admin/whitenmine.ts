// 📤 নিজের ছবি সাদা (lib/admin/whiten.tsx minePage): the owner's own pictures go up (kept out of the shop), the cloud AI
// makes them white (lib/models/whitencloud.ts), and each finished one can be downloaded. Nothing runs on this device
// but the upload itself.
import { $, $all } from '../dom.js';
import { h } from '../jsx.js';
import { postJSON, toast } from './core.js';
import { upload } from './images.js';

type Job = { id: number; media_id: number; status: string; url?: string; error?: string };

export function startWhitenMine(): void {
  const box = $('[data-mine]');
  if (!box) return;
  const status = $('[data-mine-status]', box);
  const say = (t: string) => { if (status) status.textContent = t; };
  const fast = !!box.dataset.wtFast;
  let timer = 0;

  const show = (fig: HTMLElement, j: Job) => {
    const msg = $('[data-mine-msg]', fig);
    const dl = $<HTMLAnchorElement>('[data-mine-dl]', fig);
    fig.dataset.mineState = j.status;
    if (j.status === 'done' || j.status === 'kept') {
      if (j.url) $('[data-mine-after]', fig)?.replaceChildren(h('a', { href: j.url, target: '_blank', rel: 'noopener', title: 'বড় করে দেখুন' }, h('img', { src: j.url, alt: 'পরে' })));
      if (msg) msg.textContent = '✅ তৈরি';
      if (dl) dl.hidden = false;
    } else if (j.status === 'failed') {
      if (msg) msg.textContent = '⚠️ ' + (j.error || 'হয়নি');
    } else if (msg) msg.textContent = '☁️ অনলাইনে তৈরি হচ্ছে…';
  };
  const poll = async () => {
    timer = 0;
    const figs = $all<HTMLElement>('[data-mine-job]', box);
    const ids = figs.map((f) => f.dataset.mineJob).filter(Boolean);
    if (!ids.length) return;
    try {
      const r = (await (await fetch(`/admin/api/whiten-cloud?ids=${ids.join(',')}`, { credentials: 'same-origin' })).json()) as { jobs: Job[] };
      let left = 0;
      for (const j of r.jobs) {
        const f = figs.find((x) => x.dataset.mineJob === String(j.id));
        if (!f) continue;
        show(f, j);
        if (j.status === 'queued') left++;
      }
      say(left ? `☁️ ${left}টা ছবি অনলাইনে তৈরি হচ্ছে — ${fast ? 'সাধারণত ১–৩ মিনিট' : 'কখনো ৩০ মিনিটও লাগতে পারে'}। পেজ বন্ধ করলেও কাজ চলবে।` : '✅ সব ছবি তৈরি — "⬇️ ডাউনলোড" চাপুন।');
      if (left) timer = window.setTimeout(() => void poll(), fast ? 8000 : 20000);
    } catch { timer = window.setTimeout(() => void poll(), 30000); }
  };

  const files = $<HTMLInputElement>('[data-mine-files]', box);
  files?.addEventListener('change', async () => {
    const list = Array.from(files.files || []).filter((f) => f.type.startsWith('image/'));
    files.value = '';
    if (!list.length) return;
    const ids: number[] = [];
    for (let i = 0; i < list.length; i++) {
      say(`⏫ ছবি তোলা হচ্ছে ${i + 1} / ${list.length}…`);
      // kept out of the shop's picture service (private), full quality up to 1800 px
      try { ids.push((await upload(list[i], { max: 1800, thumb: 420, private: true })).id); } catch (e) { toast(`${list[i].name}: ${(e as Error).message}`); }
    }
    if (!ids.length) { say('⚠️ কোনো ছবি তোলা যায়নি।'); return; }
    say('☁️ অনলাইনে পাঠানো হচ্ছে…');
    try {
      await postJSON('/admin/api/whiten-mine', { ids, bright: !!$<HTMLInputElement>('[data-mine-bright]', box)?.checked, clean: !!$<HTMLInputElement>('[data-mine-clean]', box)?.checked,
        glare: !!$<HTMLInputElement>('[data-mine-glare]', box)?.checked, base: !!$<HTMLInputElement>('[data-mine-base]', box)?.checked });
      location.reload();
    } catch (e) { say('⚠️ ' + (e as Error).message); }
  });

  box.addEventListener('click', async (ev) => {
    const t = ev.target as HTMLElement;
    const del = t.closest<HTMLElement>('[data-mine-del]');
    if (del) {
      if (!confirm('এই ছবিটা মুছে ফেলবেন?')) return;
      try { await postJSON(`/admin/api/whiten-mine/${del.dataset.mineDel}/delete`, {}); del.closest('figure')?.remove(); } catch (e) { toast((e as Error).message); }
      return;
    }
    if (t.closest('[data-mine-all]')) {
      // one after another (the browser may ask once whether this page may download several files)
      const links = $all<HTMLAnchorElement>('[data-mine-dl]', box).filter((a) => !a.hidden);
      for (const a of links) { a.click(); await new Promise((r) => setTimeout(r, 900)); }
    }
  });

  void poll();
  window.addEventListener('pagehide', () => clearTimeout(timer));
}

// 🔗 লিংক থেকে ছবি → JPG (lib/admin/whiten.tsx imgFetch): the shop brings the picture, this browser turns it into a
// JPG on white (any format the browser can show: WebP, AVIF, PNG, GIF, BMP, SVG …) and offers it for download.
export function startToJpg(): void {
  const box = $('[data-tojpg]');
  if (!box) return;
  const status = $('[data-tojpg-status]', box);
  const list = $('[data-tojpg-list]', box)!;
  const say = (t: string) => { if (status) status.textContent = t; };
  const toJpg = (blob: Blob): Promise<{ jpg: Blob; w: number; h: number }> => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      // SVGs without a size get a sensible one; very big pictures stay within 4000px
      let w = img.naturalWidth || 1200, h = img.naturalHeight || 1200;
      const k = Math.min(1, 4000 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d')!;
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); // see-through parts become white, as a JPG has no see-through
      x.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve({ jpg: b, w, h }) : reject(new Error('JPG বানানো যায়নি'))), 'image/jpeg', 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('এই ব্রাউজার ছবিটা খুলতে পারছে না')); };
    img.src = url;
  });
  const one = async (link: string) => {
    const r = await fetch(`/admin/api/img-fetch?url=${encodeURIComponent(link)}`, { credentials: 'same-origin' });
    if (!r.ok) { const j = (await r.json().catch(() => ({}))) as { error?: string }; throw new Error(j.error || 'ছবিটা আনা যায়নি'); }
    const name = decodeURIComponent(r.headers.get('X-Picture-Name') || 'picture');
    const { jpg, w, h: ht } = await toJpg(await r.blob());
    const href = URL.createObjectURL(jpg);
    const fig = h('figure', { className: 'mine-pic' },
      h('a', { href, target: '_blank', rel: 'noopener' }, h('img', { src: href, alt: name, className: 'tojpg-img' })),
      h('figcaption', { className: 'small' }, `${w}×${ht} · ${Math.max(1, Math.round(jpg.size / 1024))} KB `,
        h('a', { className: 'btn btn-sm', href, download: `${name}.jpg` }, '⬇️ JPG ডাউনলোড')));
    list.prepend(fig);
  };
  $('[data-tojpg-go]', box)?.addEventListener('click', async () => {
    const area = $<HTMLTextAreaElement>('[data-tojpg-urls]', box);
    const links = String(area?.value || '').split(/\s+/).map((x) => x.trim()).filter((x) => /\w\.\w/.test(x)).slice(0, 20);
    if (!links.length) { say('আগে একটা ছবির লিংক দিন।'); return; }
    let ok = 0;
    for (let i = 0; i < links.length; i++) {
      say(`⏳ ছবি আনা হচ্ছে ${i + 1} / ${links.length}…`);
      try { await one(links[i]); ok++; } catch (e) { toast(`${links[i].slice(0, 60)} — ${(e as Error).message}`); }
    }
    say(ok ? `✅ ${ok}টি ছবি JPG হয়েছে — প্রতিটার নিচে "⬇️ JPG ডাউনলোড" চাপুন।` : '⚠️ কোনো ছবি আনা যায়নি।');
    if (ok && area) area.value = '';
  });
}
