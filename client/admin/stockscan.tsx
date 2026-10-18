// সবমিলবে admin — 📷 স্ক্যান করে স্টক (lib/admin/stockscan.tsx)
// scan → the product opens → type how many came / how many you counted → Enter. A barcode gun types the code and presses Enter.
import { h, Fragment, paint } from '../jsx.js';
import { bn, getJson, latin, postJson, store, whenReady } from '../dom.js';
import { beep, startCamera } from './scan.js';

void Fragment;
/** lib/admin/stockscan.tsx answers: GET …/find, POST …/save (in, count, undo) */
type Found = { exact: Item | null; list: Item[]; box?: string; unknown?: string };
type Saved = { ok: true; change: number; product: Item; message: string; warn: string } | { ok: false; error: string };
type Item = { id: number; name: string; image?: string; emoji?: string; barcode?: string; sku?: string; active?: boolean; main: number; held?: number; shelf: number; location?: string };

whenReady(() => {
  const root = document.querySelector<HTMLElement>('[data-stockscan]');
  if (root) start(root);
});

function start(root: HTMLElement): void {
  const $ = <T extends HTMLElement = HTMLElement>(s: string, el: ParentNode = root) => el.querySelector<T>(s)!;
  const input = $<HTMLInputElement>('[data-ss-input]');
  const msg = $('[data-ss-msg]');
  const card = $('[data-ss-card]');
  const oneEl = $<HTMLInputElement>('[data-ss-onebyone]');
  const oneWrap = $('[data-ss-onebyone-wrap]');
  const boxNow = $<HTMLInputElement>('[data-ss-boxnow]');
  const helpEl = $('[data-ss-modehelp]');
  const logWrap = $('[data-ss-log-wrap]', document);
  const logBody = $('[data-ss-log]', document);
  let mode: 'in' | 'count' = 'in';
  let current: Item | null = null;
  let lastCode = '';
  let lastAt = 0;
  const say = (t: string, kind = '') => { msg.textContent = t || ''; msg.className = `ho-msg ${kind}`; };
  const post = (url: string, data: unknown) => postJson<Saved>(url, data).then((x) => x.j);

  // ---------- mode ----------
  const HELP = {
    in: 'বারকোড স্ক্যান করুন → কতগুলো এসেছে লিখে Enter চাপুন। স্টকে যোগ হবে।',
    count: 'বক্স খুলে গুনুন → বারকোড স্ক্যান করে আসল সংখ্যাটা লিখে Enter। স্টক সেই সংখ্যায় ঠিক হয়ে যাবে।',
  };
  const setMode = (m: string | null) => {
    mode = m === 'count' ? 'count' : 'in';
    store('sm_ss_mode', mode);
    for (const b of Array.from(root.querySelectorAll('[data-ss-mode]'))) b.classList.toggle('on', b.getAttribute('data-ss-mode') === mode);
    helpEl.textContent = HELP[mode];
    oneWrap.hidden = mode !== 'in';
    if (current) draw();
    input.focus();
  };
  root.addEventListener('click', (e) => { const b = (e.target as Element).closest('[data-ss-mode]'); if (b) setMode(b.getAttribute('data-ss-mode')); });
  oneEl.checked = store('sm_ss_one') === '1';
  oneEl.addEventListener('change', () => { store('sm_ss_one', oneEl.checked ? '1' : '0'); input.focus(); });
  boxNow.value = store('sm_ss_box') || '';
  boxNow.addEventListener('change', () => { store('sm_ss_box', boxNow.value.trim()); });
  setMode(store('sm_ss_mode') || 'in');

  // ---------- one product ----------
  const Pic = ({ p }: { p: Item }) => (p.image ? <img src={p.image} alt="" /> : <span className="ho-pe">{p.emoji || '📦'}</span>);
  function draw(): void {
    const p = current;
    if (!p) { paint(card); return; }
    const loc = boxNow.value.trim() || p.location || '';
    const count = mode === 'count';
    paint(card,
      <div className="ho-card ss-card">
        <div className="ss-head"><Pic p={p} /><div className="ss-name"><b>{p.name}</b>
          <small>{p.barcode || ''}{p.sku ? ` · SKU ${p.sku}` : ''}{p.active ? '' : ' · দোকানে লুকানো'}</small></div></div>
        <div className="ss-nums"><span>এখন স্টক<b>{bn(p.main)}</b></span>
          {p.held ? <><span>অর্ডারে আটকে<b>{bn(p.held)}</b></span><span>তাকে মোট<b>{bn(p.shelf)}</b></span></> : null}
          <span>📍 বক্স<b>{p.location || '—'}</b></span></div>
        <form className="ss-form" data-ss-form="">
          <label className="ss-qty"><span>{count ? '🔢 গুনে কতগুলো পেলেন?' : '📥 কতগুলো এসেছে?'}</span>
            <input type="text" inputmode="numeric" autocomplete="off" data-ss-qty="" placeholder={count ? `যেমন: ${bn(p.shelf)}` : '১'} required /></label>
          <label className="ss-loc"><span>📍 কোথায় রাখা</span><input type="text" maxlength="40" list="ss-loc-list" data-ss-loc="" value={loc} placeholder="যেমন: বক্স ৩" /></label>
          <button className="btn btn-lg">{count ? '✔ গণনা সেভ' : '✔ স্টকে যোগ'}</button></form>
        <p className="small"><a href={`/admin/products/${p.id}`} target="_blank">পণ্য খুলুন</a> · <a href={`/admin/products/labels?ids=${p.id}`} target="_blank">🏷️ লেবেল প্রিন্ট</a> · <button type="button" className="link-btn small" data-ss-close="">পরেরটা স্ক্যান করুন</button></p>
      </div>);
    const q = card.querySelector<HTMLInputElement>('[data-ss-qty]');
    if (q) setTimeout(() => q.focus(), 30);
  }
  async function save(qty: string | number, loc?: string): Promise<Saved | undefined> {
    if (!current) return undefined;
    const p = current;
    const data: Record<string, unknown> = { id: p.id, mode, qty };
    if (loc !== undefined) data.location = loc;
    try {
      const j = await post('/admin/api/stock-scan/save', data);
      if (!j.ok) { beep(false); say(j.error || 'হলো না', 'bad'); return undefined; }
      beep(true);
      say(j.message + (j.warn ? `  ${j.warn}` : ''), j.warn ? 'bad' : 'ok');
      current = j.product;
      if (j.change || data.location !== undefined) addLog(j.product, j.change);
      return j;
    } catch { beep(false); say('সংযোগে সমস্যা — আবার চেষ্টা করুন', 'bad'); return undefined; }
  }
  card.addEventListener('submit', async (e) => {
    if (!(e.target as Element).closest('[data-ss-form]')) return;
    e.preventDefault();
    const qtyBox = $<HTMLInputElement>('[data-ss-qty]');
    const raw = latin(qtyBox.value.trim());
    // the barcode gun typed a code into the number box (the next product was scanned) → treat it as a scan
    if (raw && !/^\d{1,6}$/.test(raw)) { qtyBox.value = ''; void scan(raw); return; }
    if (raw === '') { say(mode === 'count' ? 'গুনে কতগুলো পেলেন লিখুন' : 'কতগুলো এসেছে লিখুন', 'bad'); return; }
    const j = await save(raw, $<HTMLInputElement>('[data-ss-loc]').value.trim());
    if (j?.ok) { current = null; draw(); input.value = ''; input.focus(); }
  });
  card.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-ss-close]')) { current = null; draw(); say(''); input.focus(); }
    const pick = t.closest('[data-ss-pick]');
    if (pick) { current = JSON.parse(pick.getAttribute('data-ss-pick') || 'null'); say(''); draw(); }
  });

  // ---------- what was done (with undo) ----------
  function addLog(p: Item, change: number): void {
    logWrap.hidden = false;
    logBody.prepend(
      <tr><td><b>{p.name}</b>{p.sku ? <><br /><span className="small muted">SKU {p.sku}</span></> : null}</td>
        <td className={`num ${change < 0 ? 'warn' : 'good'}`}>{change ? `${change > 0 ? '+' : '−'}${bn(Math.abs(change))}` : '০'}</td>
        <td className="num">{bn(p.main)}</td><td className="small">{p.location || '—'}</td>
        <td>{change ? <button type="button" className="link-btn small" data-ss-undo={String(p.id)} data-ss-change={String(-change)}>↩️ ফেরান</button> : null}</td></tr>);
  }
  logBody.addEventListener('click', async (e) => {
    const b = (e.target as Element).closest('[data-ss-undo]');
    if (!b || !confirm('এই বদলটা ফেরাবেন?')) return;
    const j = await post('/admin/api/stock-scan/save', { id: b.getAttribute('data-ss-undo'), mode: 'undo', change: b.getAttribute('data-ss-change') });
    say(j.ok ? j.message : j.error, j.ok ? 'ok' : 'bad');
    if (j.ok) { b.closest('tr')?.classList.add('row-off'); b.remove(); }
  });

  // ---------- scan / search ----------
  const List = ({ title, list }: { title: string; list: Item[] }) => (
    <div className="ho-card"><p><b>{title}</b></p><ul className="ho-items">{list.map((p) =>
      <li><Pic p={p} /><span className="ho-n"><b>{p.name}</b>{p.location ? <span className="loc-chip">📍 {p.location}</span> : null}
        <small>{p.barcode || ''}{p.sku ? ` · SKU ${p.sku}` : ''}</small></span><span className="ho-q">{bn(p.shelf)}</span>
        <button type="button" className="btn btn-sm" data-ss-pick={JSON.stringify(p)}>এটা</button></li>)}</ul></div>
  );
  async function scan(raw: string): Promise<void> {
    const code = String(raw || '').trim();
    if (!code) return;
    // ⚡ one piece per scan: the same product again → +1 at once
    const oneByOne = mode === 'in' && oneEl.checked;
    if (oneByOne && current?.barcode && current.barcode.toUpperCase() === code.toUpperCase()) {
      await save(1, boxNow.value.trim() || undefined);
      draw();
      return;
    }
    say('খোঁজা হচ্ছে…', '');
    try {
      const j = await getJson<Found>(`/admin/api/stock-scan/find?q=${encodeURIComponent(code)}`);
      if (j.exact) {
        current = j.exact;
        if (oneByOne) { await save(1, boxNow.value.trim() || undefined); draw(); return; }
        beep(true);
        say('');
        draw();
        return;
      }
      current = null;
      if (j.box && j.list.length) { beep(true); say(''); paint(card, <List title={`📍 ${j.box} — ভেতরে ${bn(j.list.length)}টি পণ্য`} list={j.list} />); return; }
      if (j.list?.length) { say(''); paint(card, <List title={`কোনটা? (${bn(j.list.length)}টি মিলেছে)`} list={j.list} />); return; }
      beep(false);
      if (j.unknown) {
        const u = `/admin/products/new?barcode=${encodeURIComponent(j.unknown)}${boxNow.value.trim() ? `&location=${encodeURIComponent(boxNow.value.trim())}` : ''}&stock=0`;
        say(`"${code}" — এই বারকোডের কোনো পণ্য দোকানে নেই।`, 'bad');
        paint(card, <div className="ho-card not-ready"><p>নতুন পণ্য হলে আগে দোকানে তুলুন — বারকোডটা বসানো থাকবে। তারপর এখানে এসে আবার স্ক্যান করে স্টক দিন।</p>
          <a className="btn" href={u} target="_blank">➕ নতুন পণ্য হিসেবে যোগ করুন</a></div>);
        return;
      }
      say(`"${code}" — কিছু পাওয়া যায়নি`, 'bad');
      paint(card);
    } catch { beep(false); say('সংযোগে সমস্যা — আবার চেষ্টা করুন', 'bad'); }
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = input.value; input.value = ''; void scan(v); } });
  $('[data-ss-go]').addEventListener('click', () => { const v = input.value; input.value = ''; void scan(v); input.focus(); });
  // a barcode gun types fast: when nothing is focused, the keys go to the scan box
  document.addEventListener('keydown', (e) => { if (document.activeElement === document.body && /^[\w-]$/.test(e.key)) input.focus(); });

  // ---------- camera ----------
  const camBox = $('[data-ss-cambox]');
  let stopCam: (() => void) | null = null;
  $('[data-ss-cam]').addEventListener('click', () => {
    camBox.hidden = false;
    stopCam = startCamera($<HTMLVideoElement>('video', camBox), (code) => {
      // the camera sees the same sticker many times a second: one scan per sticker (unless ⚡ one-by-one, then a pause)
      const now = Date.now();
      if (code === lastCode && now - lastAt < (oneEl.checked && mode === 'in' ? 1500 : 4000)) return;
      lastCode = code;
      lastAt = now;
      void scan(code);
    }, (err) => { say(err, 'bad'); camBox.hidden = true; });
  });
  $('[data-ss-camoff]').addEventListener('click', () => { stopCam?.(); stopCam = null; camBox.hidden = true; input.focus(); });
}
