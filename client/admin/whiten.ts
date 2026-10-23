// ⬜ ব্যাকগ্রাউন্ড সাদা (lib/admin/whiten.tsx): an AI runs right here in the owner's browser through ONNX Runtime Web
// (WebGPU when the computer has it, else WebAssembly), cuts the product out of each picture and puts it on pure white
// #FFFFFF. Nothing is saved until the owner ticks "রাখুন" and presses save. Two AIs (kept in the browser's cache after
// the first time):
//   best — BiRefNet lite (MIT, ~225 MB in /vendor/birefnet): the sharpest edges, hair-thin cables, see-through plastic
//   fast — ISNet "isnet-general-use" (Apache-2.0, ~180 MB in /vendor/bgremove): quicker on a slow computer
// The edges are cleaned of the old background's colour (no grey / coloured halo on white), and "✨ উজ্জ্বল" gently
// brightens the product itself (levels + a touch of colour) — never anything the owner doesn't see first.
import { $, $all, hit } from '../dom.js';
import { h } from '../jsx.js';
import { postJSON, toast } from './core.js';

const RUNTIME = '/vendor/bgremove/';
const S = 1024; // the AI's picture size
const MAX_SIDE = 2000; // the white picture's longest side
type ModelKey = 'best' | 'fast';
const MODELS: Record<ModelKey, { base: string; how: 'imagenet' | 'isnet' }> = {
  best: { base: '/vendor/birefnet/', how: 'imagenet' },
  fast: { base: '/vendor/bgremove/', how: 'isnet' },
};
export type Options = { model: ModelKey; clean: boolean; bright: boolean };

type Tensor = { data: Float32Array };
type Session = { inputNames: string[]; outputNames: string[]; run(feeds: Record<string, unknown>): Promise<Record<string, Tensor>>; release?(): Promise<void> };
type Ort = {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create(model: Uint8Array, opts: { executionProviders: string[]; enableMemPattern?: boolean; enableCpuMemArena?: boolean }): Promise<Session> };
};
type Result = { data: string; width: number; height: number; url: string };

let ort: Promise<Ort> | null = null;
let bestFails = false;
let ready: { key: ModelKey; p: Promise<{ session: Session; how: string }> } | null = null;

async function modelBytes(base: string, say: (t: string) => void): Promise<Uint8Array> {
  const man = (await (await fetch(base + 'model.json', { cache: 'no-cache' })).json()) as { size: number; sha256: string; parts: string[] };
  const cache = 'caches' in window ? await caches.open('sm-bgremove-' + man.sha256.slice(0, 12)).catch(() => null) : null;
  const all = new Uint8Array(man.size);
  let at = 0;
  for (const p of man.parts) {
    const url = base + p;
    let r = cache ? await cache.match(url) : undefined;
    if (!r) {
      say(`⏳ AI নামানো হচ্ছে… ${Math.round((at / man.size) * 100)}% (প্রথমবার, একবারই)`);
      r = await fetch(url);
      if (!r.ok) throw new Error(`AI ফাইল পাওয়া যায়নি (${r.status})`);
      if (cache) await cache.put(url, r.clone()).catch(() => {});
    }
    const b = new Uint8Array(await r.arrayBuffer());
    if (at + b.length > man.size) throw new Error('AI ফাইল ঠিক নেই — পেজটা আবার খুলুন।');
    all.set(b, at);
    at += b.length;
  }
  if (at !== man.size) throw new Error('AI ফাইল পুরো নামেনি — পেজটা আবার খুলুন।');
  return all;
}

class NoGpu extends Error {}
let gpuCheck: Promise<boolean> | null = null;
const hasGpu = () => (gpuCheck ??= (async () => {
  const g = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try { return !!(g && (await g.requestAdapter())); } catch { return false; }
})());

function load(key: ModelKey, say: (t: string) => void) {
  if (ready && ready.key === key) return ready.p;
  const old = ready;
  const p = (async () => {
    if (old) { try { await (await old.p).session.release?.(); } catch { /* it failed anyway */ } }
    ort ??= (async () => {
      const o = (await import(RUNTIME + 'ort.webgpu.min.mjs')) as Ort;
      o.env.wasm.wasmPaths = RUNTIME;
      o.env.wasm.numThreads = 1; // (the admin page is not "cross-origin isolated", so no threads)
      return o;
    })();
    const o = await ort;
    // the big AI runs only on a graphics chip: in WebAssembly it runs out of its 4 GB and breaks the runtime for
    // the quick AI too — so without WebGPU it isn't even downloaded
    const gpu = await hasGpu();
    if (key === 'best' && !gpu) throw new NoGpu();
    const bytes = await modelBytes(MODELS[key].base, say);
    say('⏳ AI চালু হচ্ছে…');
    if (gpu) {
      try { return { session: await o.InferenceSession.create(bytes, { executionProviders: ['webgpu'] }), how: 'WebGPU (দ্রুত)' }; } catch (e) {
        if (key === 'best') throw new NoGpu(String(e));
      }
    }
    // (WebAssembly has at most 4 GB: no memory kept in reserve, so the big AI fits)
    return { session: await o.InferenceSession.create(bytes, { executionProviders: ['wasm'], enableMemPattern: false, enableCpuMemArena: false }), how: 'WebAssembly' };
  })();
  ready = { key, p };
  p.catch(() => { if (ready && ready.p === p) ready = null; });
  return p;
}

const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const ctx2d = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;

/** The mask's separate pieces; small ones far from the product (a line of text, a phone number the AI kept) are
 *  dropped: only pieces at least 8% the size of the biggest one stay. 1 = keep. */
function bigPieces(m: ArrayLike<number>): Uint8Array {
  const N = S * S, cut = 0.1;
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
  let big = 0;
  for (const n of sizes) if (n > big) big = n; // (not Math.max(...sizes): a busy photo has too many pieces for that)
  const out = new Uint8Array(N);
  for (let p = 0; p < N; p++) out[p] = label[p] === -1 ? 1 : sizes[label[p]] >= big * 0.08 ? 1 : 0;
  return out;
}

/** The AI's mask (0…1, 1024 × 1024) for the picture on canvas `src`. */
async function mask(src: HTMLCanvasElement, key: ModelKey, say: (t: string) => void): Promise<Float32Array> {
  const { session } = await load(key, say);
  const o = await ort!;
  const inp = canvas(S, S); const ic = ctx2d(inp);
  ic.imageSmoothingQuality = 'high';
  ic.drawImage(src, 0, 0, S, S);
  const d = ic.getImageData(0, 0, S, S).data;
  const f = new Float32Array(3 * S * S);
  if (MODELS[key].how === 'imagenet') {
    // BiRefNet: ÷255, then ImageNet mean / spread
    const mean = [0.485, 0.456, 0.406], sd = [0.229, 0.224, 0.225];
    for (let i = 0, p = 0; p < S * S; i += 4, p++) for (let c = 0; c < 3; c++) f[c * S * S + p] = (d[i + c] / 255 - mean[c]) / sd[c];
  } else {
    // ISNet (as rembg does): ÷ the brightest value − 0.5
    let max = 1;
    for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i], d[i + 1], d[i + 2]);
    for (let i = 0, p = 0; p < S * S; i += 4, p++) for (let c = 0; c < 3; c++) f[c * S * S + p] = d[i + c] / max - 0.5;
  }
  const out = await session.run({ [session.inputNames[0]]: new o.Tensor('float32', f, [1, 3, S, S]) });
  const raw = out[session.outputNames[0]].data; // (ISNet gives several masks: the first is the finished one; BiRefNet gives one)
  const m = new Float32Array(S * S);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < S * S; i++) { if (raw[i] < lo) lo = raw[i]; if (raw[i] > hi) hi = raw[i]; }
  if (MODELS[key].how === 'imagenet' && (lo < -0.01 || hi > 1.01)) {
    for (let i = 0; i < S * S; i++) m[i] = 1 / (1 + Math.exp(-raw[i])); // raw scores → 0…1
  } else {
    const span = hi - lo || 1;
    for (let i = 0; i < S * S; i++) m[i] = (raw[i] - lo) / span;
  }
  return m;
}

/** The old background's colour around each spot (so an edge pixel's mixed-in background can be taken out again). */
function localBackground(px: Uint8ClampedArray, a: Uint8ClampedArray, W: number, H: number): Float32Array {
  const G = 48, gw = Math.ceil(W / G), gh = Math.ceil(H / G);
  const sum = new Float64Array(gw * gh * 3), n = new Float64Array(gw * gh);
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const i = (y * W + x) * 4;
    if (a[i + 3] > 12) continue;
    const g = Math.floor(y / G) * gw + Math.floor(x / G);
    sum[g * 3] += px[i]; sum[g * 3 + 1] += px[i + 1]; sum[g * 3 + 2] += px[i + 2]; n[g]++;
  }
  // cells with no background (inside the product) take their neighbours' colour, spreading outwards
  const col = new Float32Array(gw * gh * 3), have = new Uint8Array(gw * gh);
  for (let g = 0; g < gw * gh; g++) if (n[g]) { have[g] = 1; for (let c = 0; c < 3; c++) col[g * 3 + c] = sum[g * 3 + c] / n[g]; }
  if (!have.some((x) => x)) { col.fill(255); return col; }
  for (let pass = 0; pass < gw + gh && have.some((x) => !x); pass++) {
    const next = have.slice();
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const g = gy * gw + gx;
      if (have[g]) continue;
      let k = 0; const acc = [0, 0, 0];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = gx + dx, Y = gy + dy;
        if (X < 0 || Y < 0 || X >= gw || Y >= gh || !have[Y * gw + X]) continue;
        for (let c = 0; c < 3; c++) acc[c] += col[(Y * gw + X) * 3 + c];
        k++;
      }
      if (k) { for (let c = 0; c < 3; c++) col[g * 3 + c] = acc[c] / k; next[g] = 1; }
    }
    have.set(next);
  }
  const out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const g = Math.floor(y / G) * gw + Math.floor(x / G);
    const o = (y * W + x) * 3;
    out[o] = col[g * 3]; out[o + 1] = col[g * 3 + 1]; out[o + 2] = col[g * 3 + 2];
  }
  return out;
}

/** ✨ The product a little brighter and clearer: its own darkest / brightest 0.5% become black / white (within
 *  limits, so nothing turns harsh), mid-tones lifted a touch, colours a touch richer. Only product pixels count. */
function brighten(o: Uint8ClampedArray, al: Float32Array): void {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let p = 0, i = 0; p < al.length; p++, i += 4) {
    if (al[p] < 0.6) continue;
    hist[Math.round(0.299 * o[i] + 0.587 * o[i + 1] + 0.114 * o[i + 2])]++; n++;
  }
  if (n < 500) return;
  const pct = (q: number) => { let c = 0; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= n * q) return v; } return 255; };
  const lo = Math.min(pct(0.005), 28), hi = Math.max(pct(0.995), 200);
  const gain = Math.min(255 / Math.max(1, hi - lo), 1.3);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(Math.min(1, Math.max(0, ((v - lo) * gain) / 255)), 0.93));
  for (let p = 0, i = 0; p < al.length; p++, i += 4) {
    if (al[p] <= 0) continue;
    let r = lut[o[i]], g = lut[o[i + 1]], b = lut[o[i + 2]];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    r = y + (r - y) * 1.08; g = y + (g - y) * 1.08; b = y + (b - y) * 1.08;
    o[i] = r; o[i + 1] = g; o[i + 2] = b;
  }
}

/** One picture → its white-background copy. */
export async function whiten(id: string, say: (t: string) => void, opt: Options = { model: 'best', clean: true, bright: false }): Promise<Result> {
  const r = await fetch(`/media/${id}?raw=1`, { cache: 'no-store', credentials: 'same-origin' });
  if (!r.ok) throw new Error('ছবি পড়া যায়নি');
  const bmp = await createImageBitmap(await r.blob());
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const W = Math.max(1, Math.round(bmp.width * k)), H = Math.max(1, Math.round(bmp.height * k));
  const src = canvas(W, H); const sc = ctx2d(src);
  sc.fillStyle = '#fff'; sc.fillRect(0, 0, W, H); // (a see-through picture: its empty parts count as white)
  sc.drawImage(bmp, 0, 0, W, H);
  let m: Float32Array;
  if (opt.model === 'best' && !bestFails) {
    try { m = await mask(src, 'best', say); } catch (e) {
      // the big AI needs a graphics chip (WebGPU); without one the quick AI does it instead
      // (any failure of the big AI — no graphics chip, or the chip too small — never stops the work)
      bestFails = true; ready = null;
      console.warn('BiRefNet failed, using ISNet:', e);
      toast(e instanceof NoGpu ? '🧠 সেরা মান এই কম্পিউটারে চলছে না (গ্রাফিক্স সাপোর্ট নেই) — ⚡ দ্রুত AI দিয়ে করা হচ্ছে।' : '🧠 সেরা মান এই কম্পিউটারে চলল না — ⚡ দ্রুত AI দিয়ে করা হচ্ছে।');
      m = await mask(src, 'fast', say);
    }
  } else m = await mask(src, opt.model === 'best' ? 'fast' : opt.model, say);
  const keep = opt.clean ? bigPieces(m) : null;
  // the mask, back to the picture's own size (smoothly, so the edges stay soft)
  const mc = canvas(S, S); const mx = ctx2d(mc); const md = mx.createImageData(S, S);
  for (let p = 0; p < S * S; p++) md.data[p * 4 + 3] = keep && !keep[p] ? 0 : Math.round(m[p] * 255);
  mx.putImageData(md, 0, 0);
  const big = canvas(W, H); const bx = ctx2d(big);
  bx.imageSmoothingQuality = 'high';
  bx.drawImage(mc, 0, 0, W, H);
  const a = bx.getImageData(0, 0, W, H).data;
  const px = sc.getImageData(0, 0, W, H);
  const o = px.data;
  // how much of each pixel is product: faint haze → fully white, the product's body → exactly as it was
  const al = new Float32Array(W * H);
  for (let p = 0; p < W * H; p++) { const v = (a[p * 4 + 3] / 255 - 0.04) / 0.92; al[p] = v <= 0 ? 0 : v >= 1 ? 1 : v; }
  // clean edges: an edge pixel is part product, part old background — take the old background's colour out of it,
  // so a grey or coloured rim doesn't show on the white
  const bg = localBackground(o, a, W, H);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const v = al[p];
    if (v <= 0.15 || v >= 0.98) continue;
    for (let c = 0; c < 3; c++) {
      const F = (o[i + c] - (1 - v) * bg[p * 3 + c]) / v;
      o[i + c] = F < 0 ? 0 : F > 255 ? 255 : F;
    }
  }
  if (opt.bright) brighten(o, al);
  for (let p = 0, i = 0; p < W * H; p++, i += 4) {
    const v = al[p];
    o[i] = 255 + (o[i] - 255) * v; o[i + 1] = 255 + (o[i + 1] - 255) * v; o[i + 2] = 255 + (o[i + 2] - 255) * v; o[i + 3] = 255;
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
  const options = (): Options => ({
    model: $<HTMLSelectElement>('[data-wt-model]', box)?.value === 'fast' ? 'fast' : 'best',
    clean: $<HTMLInputElement>('[data-wt-clean]', box)?.checked !== false,
    bright: $<HTMLInputElement>('[data-wt-bright]', box)?.checked === true,
  });

  const one = async (fig: HTMLElement) => {
    const id = fig.dataset.wtMedia!;
    msg(fig, ' ⏳');
    try {
      const r = await whiten(id, say, options());
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
      const r = await ready?.p.catch(() => null);
      say(`✅ ${figs.length}টা ছবি তৈরি${r ? ` (${r.how})` : ''} — আগে/পরে দেখে খারাপগুলোর টিক তুলে দিন, তারপর "💾 টিক দেওয়াগুলো রাখুন"।`);
    } catch (e) { say('⚠️ ' + (e as Error).message); } finally { busy = false; if (runBtn) runBtn.disabled = false; }
  };

  box.addEventListener('click', async (e) => {
    if (hit(e, '[data-wt-run]')) {
      const onlyNew = $<HTMLInputElement>('[data-wt-only-new]', box)?.checked !== false;
      void run($all<HTMLElement>('[data-wt-media]', box).filter((f) => !(onlyNew && f.dataset.white)));
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
