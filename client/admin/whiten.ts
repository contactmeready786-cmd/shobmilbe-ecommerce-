// ⬜ ব্যাকগ্রাউন্ড সাদা (lib/admin/whiten.tsx): an AI (ISNet, "isnet-general-use") runs right here in the owner's
// browser through ONNX Runtime Web (WebGPU when the computer has it, else WebAssembly), cuts the product out of each
// picture and puts it on pure white #FFFFFF. Nothing is saved until the owner ticks "রাখুন" and presses save.
// The AI file (~180 MB, in 4 parts under /vendor/bgremove) is kept in the browser's cache after the first time.
import { $, $all, hit } from '../dom.js';
import { h } from '../jsx.js';
import { postJSON, toast } from './core.js';

const BASE = '/vendor/bgremove/';
const S = 1024; // the AI's picture size
const MAX_SIDE = 2000; // the white picture's longest side

type Tensor = { data: Float32Array };
type Session = { inputNames: string[]; outputNames: string[]; run(feeds: Record<string, unknown>): Promise<Record<string, Tensor>> };
type Ort = {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create(model: Uint8Array, opts: { executionProviders: string[] }): Promise<Session> };
};
type Result = { data: string; width: number; height: number; url: string };

let ready: Promise<{ ort: Ort; session: Session; how: string }> | null = null;

async function modelBytes(say: (t: string) => void): Promise<Uint8Array> {
  const man = (await (await fetch(BASE + 'model.json', { cache: 'no-cache' })).json()) as { size: number; sha256: string; parts: string[] };
  const cache = 'caches' in window ? await caches.open('sm-bgremove-' + man.sha256.slice(0, 12)).catch(() => null) : null;
  const all = new Uint8Array(man.size);
  let at = 0;
  for (const p of man.parts) {
    const url = BASE + p;
    let r = cache ? await cache.match(url) : undefined;
    if (!r) {
      say(`⏳ AI নামানো হচ্ছে… ${Math.round((at / man.size) * 100)}% (প্রথমবার, একবারই)`);
      r = await fetch(url);
      if (!r.ok) throw new Error(`AI ফাইল পাওয়া যায়নি (${r.status})`);
      if (cache) await cache.put(url, r.clone()).catch(() => {});
    }
    const b = new Uint8Array(await r.arrayBuffer());
    all.set(b, at);
    at += b.length;
  }
  if (at !== man.size) throw new Error('AI ফাইল পুরো নামেনি — পেজটা আবার খুলুন।');
  return all;
}

function load(say: (t: string) => void) {
  ready ??= (async () => {
    const url = BASE + 'ort.webgpu.min.mjs';
    const ort = (await import(url)) as Ort;
    ort.env.wasm.wasmPaths = BASE;
    ort.env.wasm.numThreads = 1; // (the admin page is not "cross-origin isolated", so no threads)
    const bytes = await modelBytes(say);
    say('⏳ AI চালু হচ্ছে…');
    const gpu = 'gpu' in navigator;
    if (gpu) {
      try { return { ort, session: await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'] }), how: 'WebGPU (দ্রুত)' }; } catch { /* fall back below */ }
    }
    return { ort, session: await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }), how: 'WebAssembly' };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

/** The mask's separate pieces; small ones far from the product (a line of text, a phone number the AI kept) are
 *  dropped: only pieces at least 8% the size of the biggest one stay. 1 = keep. */
function bigPieces(m: ArrayLike<number>, lo: number, span: number): Uint8Array {
  const N = S * S, cut = lo + span * 0.1;
  const label = new Int32Array(N).fill(-1);
  const sizes: number[] = [];
  const stack = new Int32Array(N);
  for (let s0 = 0; s0 < N; s0++) {
    if (label[s0] !== -1 || m[s0] <= cut) continue;
    const id = sizes.length; let n = 0, top = 0;
    stack[top++] = s0; label[s0] = id;
    while (top) {
      const p = stack[--top]; n++;
      const x = p % S, y = (p - x) / S;
      for (const q of [x > 0 ? p - 1 : -1, x < S - 1 ? p + 1 : -1, y > 0 ? p - S : -1, y < S - 1 ? p + S : -1]) {
        if (q >= 0 && label[q] === -1 && m[q] > cut) { label[q] = id; stack[top++] = q; }
      }
    }
    sizes.push(n);
  }
  const big = Math.max(0, ...sizes);
  const out = new Uint8Array(N);
  for (let p = 0; p < N; p++) out[p] = label[p] === -1 ? 1 : sizes[label[p]] >= big * 0.08 ? 1 : 0;
  return out;
}

/** One picture → its white-background copy. */
export async function whiten(id: string, say: (t: string) => void, clean = true): Promise<Result> {
  const { ort, session } = await load(say);
  const r = await fetch(`/media/${id}?raw=1`, { cache: 'no-store', credentials: 'same-origin' });
  if (!r.ok) throw new Error('ছবি পড়া যায়নি');
  const bmp = await createImageBitmap(await r.blob());
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const W = Math.max(1, Math.round(bmp.width * k)), H = Math.max(1, Math.round(bmp.height * k));
  const src = canvas(W, H); const sc = ctx2d(src);
  sc.fillStyle = '#fff'; sc.fillRect(0, 0, W, H); // (a see-through picture: its empty parts count as white)
  sc.drawImage(bmp, 0, 0, W, H);
  // the AI's input: 1024 × 1024, values ÷ the brightest value − 0.5 (as rembg does for ISNet)
  const inp = canvas(S, S); const ic = ctx2d(inp);
  ic.imageSmoothingQuality = 'high';
  ic.drawImage(src, 0, 0, S, S);
  const d = ic.getImageData(0, 0, S, S).data;
  let max = 1;
  for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i], d[i + 1], d[i + 2]);
  const f = new Float32Array(3 * S * S);
  for (let i = 0, p = 0; p < S * S; i += 4, p++) { f[p] = d[i] / max - 0.5; f[S * S + p] = d[i + 1] / max - 0.5; f[2 * S * S + p] = d[i + 2] / max - 0.5; }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', f, [1, 3, S, S]) });
  const m = out[session.outputNames[0]].data;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < S * S; i++) { if (m[i] < lo) lo = m[i]; if (m[i] > hi) hi = m[i]; }
  const span = hi - lo || 1;
  const keep = clean ? bigPieces(m, lo, span) : null;
  // the mask, back to the picture's own size (smoothly, so the edges stay soft)
  const mc = canvas(S, S); const mx = ctx2d(mc); const md = mx.createImageData(S, S);
  for (let p = 0; p < S * S; p++) { md.data[p * 4 + 3] = keep && !keep[p] ? 0 : Math.round(((m[p] - lo) / span) * 255); }
  mx.putImageData(md, 0, 0);
  const big = canvas(W, H); const bx = ctx2d(big);
  bx.imageSmoothingQuality = 'high';
  bx.drawImage(mc, 0, 0, W, H);
  const a = bx.getImageData(0, 0, W, H).data;
  // the product on pure white: faint haze around it goes fully white, the product stays exactly as it was
  const px = sc.getImageData(0, 0, W, H);
  const o = px.data;
  for (let i = 0; i < o.length; i += 4) {
    let al = (a[i + 3] / 255 - 0.04) / 0.92;
    al = al <= 0 ? 0 : al >= 1 ? 1 : al;
    o[i] = 255 + (o[i] - 255) * al; o[i + 1] = 255 + (o[i + 1] - 255) * al; o[i + 2] = 255 + (o[i + 2] - 255) * al; o[i + 3] = 255;
  }
  sc.putImageData(px, 0, 0);
  let q = 0.92;
  let data = src.toDataURL('image/jpeg', q);
  while (data.length * 0.75 > 2.6 * 1024 * 1024 && q > 0.75) { q -= 0.07; data = src.toDataURL('image/jpeg', q); }
  // (the admin page may not fetch a data: address — connect-src 'self' — so the preview is made by the canvas itself)
  const blob = await new Promise<Blob | null>((ok) => src.toBlob(ok, 'image/jpeg', q));
  return { data, width: W, height: H, url: blob ? URL.createObjectURL(blob) : data };
}

export function startWhiten(): void {
  const box = $('[data-whiten]');
  if (!box) return;
  const status = $('[data-wt-status]', box);
  const saveBtn = $<HTMLButtonElement>('[data-wt-save]', box);
  const runBtn = $<HTMLButtonElement>('[data-wt-run]', box);
  const say = (t: string) => { if (status) status.textContent = t; };
  const done = new Map<string, Result>();
  let busy = false;
  const msg = (fig: Element, t: string) => { const m = $('[data-wt-msg]', fig); if (m) m.textContent = t; };

  const one = async (fig: HTMLElement) => {
    const id = fig.dataset.wtMedia!;
    msg(fig, ' ⏳');
    try {
      const r = await whiten(id, say, $<HTMLInputElement>('[data-wt-clean]', box)?.checked !== false);
      done.set(id, r);
      const after = $('[data-wt-after]', fig)!;
      after.replaceChildren(h('a', { href: r.url, target: '_blank', rel: 'noopener', title: 'বড় করে দেখুন' }, h('img', { src: r.url, alt: 'পরে' })));
      after.hidden = false;
      const keep = $('[data-wt-keep-label]', fig); if (keep) keep.hidden = false;
      msg(fig, '');
      if (saveBtn) saveBtn.disabled = false;
    } catch (e) { msg(fig, ' ⚠️ ' + (e as Error).message); }
  };

  const run = async (figs: HTMLElement[]) => {
    if (busy) return;
    busy = true; if (runBtn) runBtn.disabled = true;
    try {
      let n = 0;
      for (const f of figs) {
        n++;
        say(`⏳ ${n} / ${figs.length} — ছবি সাদা করা হচ্ছে… (পেজটা খোলা রাখুন)`);
        await one(f);
      }
      const r = await ready?.catch(() => null);
      say(`✅ ${figs.length}টা ছবি তৈরি${r ? ` (${r.how})` : ''} — আগে/পরে দেখে খারাপগুলোর টিক তুলে দিন, তারপর "💾 টিক দেওয়াগুলো রাখুন"।`);
    } catch (e) { say('⚠️ ' + (e as Error).message); } finally { busy = false; if (runBtn) runBtn.disabled = false; }
  };

  box.addEventListener('click', async (e) => {
    if (hit(e, '[data-wt-run]')) {
      const onlyNew = $<HTMLInputElement>('[data-wt-only-new]', box)?.checked !== false;
      void run($all<HTMLElement>('[data-wt-media]', box).filter((f) => !(onlyNew && f.dataset.white) && !done.has(f.dataset.wtMedia!)));
      return;
    }
    const oneBtn = hit(e, '[data-wt-one]');
    if (oneBtn) { const f = oneBtn.closest<HTMLElement>('[data-wt-media]'); if (f) void run([f]); return; }
    const undo = hit(e, '[data-wt-undo]');
    if (undo) {
      const f = undo.closest<HTMLElement>('[data-wt-media]')!;
      if (!confirm('এই ছবির আসল (আগের) ছবিটা ফেরত আনবেন?')) return;
      try {
        const j = await postJSON<{ id: number }>(`/admin/api/whiten/${f.dataset.wtMedia}/undo`, {});
        f.dataset.wtMedia = String(j.id); delete f.dataset.white; f.classList.remove('is-white');
        undo.remove(); msg(f, ' ↺ আসল ছবি ফেরত এসেছে');
      } catch (er) { toast((er as Error).message); }
      return;
    }
    if (hit(e, '[data-wt-save]')) {
      if (busy) return;
      const picks = $all<HTMLElement>('[data-wt-media]', box).filter((f) => done.has(f.dataset.wtMedia!) && $<HTMLInputElement>('[data-wt-keep]', f)?.checked);
      if (!picks.length) { toast('কোনো ছবিতে টিক নেই।'); return; }
      busy = true; if (saveBtn) saveBtn.disabled = true;
      let ok = 0;
      for (const f of picks) {
        const id = f.dataset.wtMedia!; const r = done.get(id)!;
        say(`💾 ${ok + 1} / ${picks.length} সেভ হচ্ছে…`);
        try {
          const j = await postJSON<{ id: number }>(`/admin/api/whiten/${id}`, { data: r.data, width: r.width, height: r.height });
          ok++; done.delete(id);
          // the white copy is a new picture: this tile now stands for it (so "আসল ছবি ফেরত" works right away)
          f.dataset.wtMedia = String(j.id); f.dataset.white = '1';
          f.classList.add('is-white');
          const k = $('[data-wt-keep-label]', f); if (k) k.hidden = true;
          const o = $('[data-wt-one]', f); if (o) o.replaceWith(h('button', { type: 'button', className: 'link-btn small', 'data-wt-undo': '' }, '↺ আসল ছবি ফেরত'));
          msg(f, ' ✅ রাখা হয়েছে');
        } catch (er) { msg(f, ' ⚠️ ' + (er as Error).message); }
      }
      busy = false;
      say(`✅ ${ok}টা ছবি সাদা ব্যাকগ্রাউন্ডে রাখা হলো${ok < picks.length ? ` (${picks.length - ok}টা হয়নি)` : ''}। পরের পেজে যান, অথবা পেজটা রিফ্রেশ করুন।`);
    }
  });
}
