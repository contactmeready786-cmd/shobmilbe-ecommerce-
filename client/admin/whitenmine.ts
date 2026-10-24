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
