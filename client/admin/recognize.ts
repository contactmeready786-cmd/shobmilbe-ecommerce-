// 🧠 ছবি চেনা (owner, 2026-10-24): a picture-recognition AI (DINOv2 small, Apache-2.0, ~88 MB in /vendor/dinov2,
// kept in the browser's cache after the first time) runs here in the admin's browser through ONNX Runtime Web and
// describes each product picture with 384 numbers. The server (lib/models/duplicates.ts) compares them, so the same
// product is recognised from another angle, in other light, on another background, under another name.
//   embedImage(src) — one picture → its description (base64 of 384 bytes), or null when the AI can't run here
//   startRecognize() — older product pictures, quietly in the background on product pages; the duplicates page
//                      shows the progress and a button to do them all now
import { $, bn, hit } from '../dom.js';

const RUNTIME = '/vendor/bgremove/';
const BASE = '/vendor/dinov2/';
const S = 224;
const MEAN = [0.485, 0.456, 0.406], SD = [0.229, 0.224, 0.225];

type Tensor = { data: Float32Array; dims: number[] };
type Session = { inputNames: string[]; outputNames: string[]; run(feeds: Record<string, unknown>): Promise<Record<string, Tensor>> };
type Ort = {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create(model: Uint8Array, opts: { executionProviders: string[] }): Promise<Session> };
};

let ready: Promise<{ ort: Ort; session: Session }> | null = null;
let broken = false;

async function modelBytes(): Promise<Uint8Array> {
  const man = (await (await fetch(BASE + 'model.json', { cache: 'no-cache' })).json()) as { size: number; sha256: string; parts: string[] };
  const cache = 'caches' in window ? await caches.open('sm-dinov2-' + man.sha256.slice(0, 12)).catch(() => null) : null;
  const all = new Uint8Array(man.size);
  let at = 0;
  for (const p of man.parts) {
    let r = cache ? await cache.match(BASE + p) : undefined;
    if (!r) {
      r = await fetch(BASE + p);
      if (!r.ok) throw new Error(`AI file ${r.status}`);
      if (cache) await cache.put(BASE + p, r.clone()).catch(() => {});
    }
    const b = new Uint8Array(await r.arrayBuffer());
    if (at + b.length > man.size) throw new Error('AI file too big');
    all.set(b, at);
    at += b.length;
  }
  if (at !== man.size) throw new Error('AI file incomplete');
  return all;
}

function load() {
  ready ??= (async () => {
    const ort = (await import(RUNTIME + 'ort.webgpu.min.mjs')) as Ort;
    ort.env.wasm.wasmPaths = RUNTIME;
    ort.env.wasm.numThreads = 1;
    // small enough for WebAssembly on any computer (the graphics chip isn't needed for this one)
    const session = await ort.InferenceSession.create(await modelBytes(), { executionProviders: ['wasm'] });
    return { ort, session };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

const loadImg = (src: string) => new Promise<HTMLImageElement>((ok, no) => {
  const im = new Image();
  im.onload = () => ok(im);
  im.onerror = () => no(new Error('image'));
  im.src = src;
});

/** The picture → the AI's description: the whole picture on a white square (nothing cut off), 224 × 224. */
async function describe(img: HTMLImageElement): Promise<string> {
  const { ort, session } = await load();
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const k = S / Math.max(w, h, 1);
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, (S - w * k) / 2, (S - h * k) / 2, w * k, h * k);
  const d = x.getImageData(0, 0, S, S).data;
  const f = new Float32Array(3 * S * S);
  for (let i = 0, p = 0; p < S * S; i += 4, p++) for (let ch = 0; ch < 3; ch++) f[ch * S * S + p] = (d[i + ch] / 255 - MEAN[ch]) / SD[ch];
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', f, [1, 3, S, S]) });
  const o = out[session.outputNames[0]].data; // [1, tokens, 384]: the first token describes the whole picture
  const v = o.subarray(0, 384);
  // one byte per number: scaled so the biggest is ±127 — only the direction is compared, so the scale doesn't matter
  let m = 0;
  for (let i = 0; i < 384; i++) m = Math.max(m, Math.abs(v[i]));
  const k127 = 127 / (m || 1);
  const bytes = new Uint8Array(384);
  for (let i = 0; i < 384; i++) bytes[i] = Math.round(v[i] * k127) & 0xff;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Is the AI already on this computer, or is this a computer (not a phone on mobile data) that may fetch it once? */
let mayCache: Promise<boolean> | null = null;
function mayRun(): Promise<boolean> {
  mayCache ??= (async () => {
    if (ready) return true;
    try {
      const man = (await (await fetch(BASE + 'model.json')).json()) as { sha256: string; parts: string[] };
      const c = 'caches' in window ? await caches.open('sm-dinov2-' + man.sha256.slice(0, 12)) : null;
      if (c && (await c.match(BASE + man.parts[man.parts.length - 1]))) return true;
    } catch { /* not known: decide below */ }
    const net = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    return !net?.saveData && window.innerWidth >= 900; // ~88 MB once: not on a phone's data plan
  })();
  return mayCache;
}

/** One picture (a data: / blob: / same-site address) → its description, or null when the AI can't run here. */
export async function embedImage(src: string, force = false): Promise<string | null> {
  if (broken || (!force && !(await mayRun()))) return null;
  try { return await describe(await loadImg(src)); } catch (e) {
    if (!ready) broken = true; // the AI itself didn't load: don't hold every upload up trying again
    console.warn('picture recognition:', e);
    return null;
  }
}

// ---------- older pictures, in the background ----------
type Waiting = { ids: number[]; total: number; done: number };
export function startRecognize(): void {
  if (!/^\/admin\/products/.test(location.pathname)) return;
  const box = $('[data-recognize]');
  const status = box ? $('[data-rc-status]', box) : null;
  const say = (t: string) => { if (status) status.textContent = t; };
  let running = false;
  let made = 0;
  const run = async (eager: boolean) => {
    if (running) return;
    running = true;
    try {
      for (let round = 0; round < (eager ? 10000 : 6); round++) {
        const j = (await (await fetch('/admin/api/media/embeddings', { credentials: 'same-origin' })).json()) as Waiting;
        if (!j.ids.length) { say(`✅ সব ${bn(j.total)}টি ছবি AI চিনে রেখেছে।${made ? ' পেজটা আবার লোড করলে নতুন মিলগুলো দেখাবে।' : ''}`); return; }
        if (!eager && !(await mayRun())) { say(`📱 ${bn(j.total - j.done)}টি ছবি এখনো AI চেনেনি — কম্পিউটার থেকে "▶ এখনই সব ছবি চিনুন" চাপুন।`); return; }
        say(`🧠 ছবি চেনা হচ্ছে… ${bn(j.done)} / ${bn(j.total)} (পেজটা খোলা রাখুন)`);
        const items: { id: number; emb: string }[] = [];
        for (const id of j.ids) {
          const emb = await embedImage(`/media/${id}/t`, eager);
          if (emb === null && broken) { say('⚠️ এই ব্রাউজারে ছবি চেনার AI চালানো গেল না।'); return; }
          if (emb) items.push({ id, emb });
        }
        if (!items.length) return;
        await fetch('/admin/api/media/embeddings', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
        made += items.length;
        await new Promise((r) => setTimeout(r, eager ? 50 : 1500));
      }
    } catch { /* next time a product page opens */ } finally { running = false; }
  };
  box?.addEventListener('click', (e) => { if (hit(e, '[data-rc-run]')) void run(true); });
  // quietly, a few rounds on every product page (after the page has settled)
  setTimeout(() => void run(false), 4000);
}
