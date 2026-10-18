// সবমিলবে admin — 📦 কুরিয়ারে হ্যান্ডওভার: scan → check → hand over; and 📷 scanning a barcode into any search box.
import { h, Fragment, paint } from '../jsx.js';
import { $, $all, bn } from '../dom.js';
import { getJSON, money } from './core.js';
import { beep, startCamera } from './scan.js';

void Fragment;
type Item = { product_id: number; name: string; qty: number; image?: string; location?: string; barcode?: string; sku?: string };
/** GET /admin/api/handover?code=… (lib/admin/handover.tsx lookup) */
type Lookup = { ok: true; order: Order } | { ok: false; product?: { name: string }; error: string };
/** POST /admin/api/handover and …/undo (+ the HTTP status) */
type HandAnswer = { ok?: boolean; message?: string; error?: string; pending?: boolean; already?: boolean; code?: string; status: number };
type Order = { id: number; code: string; status: string; status_text: string; ready: boolean; customer: string; phone: string; address: string; area?: string; due: number; courier?: string; consignment?: string; items: Item[] };

function handover(ho: HTMLElement): void {
  const input = $<HTMLInputElement>('[data-ho-input]', ho)!;
  const msg = $('[data-ho-msg]', ho)!;
  const box = $('[data-ho-order]', ho)!;
  const verifyEl = $<HTMLInputElement>('[data-ho-verify]', ho)!;
  const autoEl = $<HTMLInputElement>('[data-ho-auto]', ho)!;
  let current: Order | null = null;
  let counts: Record<number, number> = {};
  try { verifyEl.checked = localStorage.getItem('sm_ho_verify') === '1'; autoEl.checked = localStorage.getItem('sm_ho_auto') === '1'; } catch { /* ignore */ }
  verifyEl.addEventListener('change', () => { try { localStorage.setItem('sm_ho_verify', verifyEl.checked ? '1' : '0'); } catch { /* ignore */ } if (current) draw(); });
  autoEl.addEventListener('change', () => { try { localStorage.setItem('sm_ho_auto', autoEl.checked ? '1' : '0'); } catch { /* ignore */ } });
  const say = (t: string, kind = '') => { msg.textContent = t || ''; msg.className = `ho-msg ${kind}`; };
  const post = async (url: string, data: unknown): Promise<HandAnswer> => {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) });
    return { ...(await r.json()), status: r.status };
  };
  const allPacked = () => !!current && current.items.every((it) => (counts[it.product_id] || 0) >= it.qty);
  function draw(): void {
    if (!current) { paint(box); return; }
    const o = current;
    const verify = verifyEl.checked;
    const done = allPacked();
    paint(box,
      <div className={`ho-card ${o.ready ? '' : 'not-ready'}`}>
        <div className="ho-head"><div><b className="ho-code">{o.code}</b> <span className="pill">{o.status_text}</span><br /><b>{o.customer}</b> · {o.phone}
          <br /><span className="small muted">{o.address}{o.area ? `, ${o.area}` : ''}</span></div>
          <div className="ho-due"><span>নিতে হবে</span><b>{money(o.due)}</b>{o.courier ? <small>{o.courier}{o.consignment ? ` · ${o.consignment}` : ''}</small> : null}</div></div>
        <ul className="ho-items">{o.items.map((it) => {
          const c = counts[it.product_id] || 0;
          const ok = c >= it.qty;
          const over = c > it.qty;
          return <li className={verify ? (over ? 'over' : ok ? 'ok' : '') : ''}>{it.image ? <img src={it.image} alt="" /> : <span className="ho-pe">📦</span>}
            <span className="ho-n"><b>{it.name}</b>{it.location ? <span className="loc-chip">📍 {it.location}</span> : null}<small>{it.barcode || 'বারকোড নেই'}{it.sku ? ` · SKU ${it.sku}` : ''}</small></span>
            <span className="ho-q">{verify ? `${bn(c)} / ` : '× '}{bn(it.qty)}{verify ? (over ? ' ⚠️' : ok ? ' ✅' : '') : ''}</span></li>;
        })}</ul>
        {verify && !done ? <p className="ho-hint">👉 বক্সের প্রতিটা পণ্যের বারকোড স্ক্যান করুন</p> : null}
        <div className="ho-actions">{o.status === 'shipped' ? <p className="ho-msg ok">✅ এটা আগেই কুরিয়ারে দেওয়া হয়েছে।</p>
          : <button type="button" className={`btn btn-lg ${verify && !done ? 'btn-ghost' : ''}`} data-ho-hand="">{verify && !done ? 'যাচাই ছাড়াই হ্যান্ডওভার' : '✅ কুরিয়ারে হ্যান্ডওভার'}</button>}
          <a className="btn btn-ghost" href={`/admin/orders/${o.id}`} target="_blank">অর্ডার খুলুন</a><button type="button" className="link-btn" data-ho-clear="">পরেরটা স্ক্যান করুন</button></div>
      </div>);
  }
  function addToday(o: Order): void {
    const t = $('[data-ho-today]');
    if (!t) return;
    let tb = $('tbody', t);
    if (!tb) {
      tb = <tbody />;
      paint(t, <table className="table compact"><thead><tr><th>সময়</th><th>অর্ডার</th><th>কাস্টমার</th><th className="num">নিতে হবে</th><th>কে দিল</th><th /></tr></thead>{tb}</table>);
    }
    tb.prepend(<tr><td className="small">এইমাত্র</td><td><a href={`/admin/orders/${o.id}`}><b>{o.code}</b></a></td><td>{o.customer}</td><td className="num">{money(o.due)}</td><td className="small">আপনি</td>
      <td><button type="button" className="link-btn small" data-ho-undo={o.code}>↩️ ভুল হয়েছে</button></td></tr>);
  }
  async function hand(force: boolean): Promise<void> {
    if (!current) return;
    try {
      const j = await post('/admin/api/handover', { code: current.code, force, verified: verifyEl.checked && allPacked() });
      if (j.ok) { beep(true); say(j.message || '', 'ok'); addToday(current); current = null; counts = {}; draw(); input.value = ''; input.focus(); return; }
      if (j.pending && confirm(j.error || '')) { await hand(true); return; }
      beep(false);
      say(j.error || 'হলো না', 'bad');
    } catch { beep(false); say('সংযোগে সমস্যা — আবার চেষ্টা করুন', 'bad'); }
  }
  async function scan(raw: string): Promise<void> {
    const code = String(raw || '').trim();
    if (!code) return;
    // a product barcode while an order is open → packing check
    if (current) {
      const up = code.toUpperCase();
      const line = current.items.find((it) => it.barcode && it.barcode.toUpperCase() === up);
      if (line) {
        counts[line.product_id] = (counts[line.product_id] || 0) + 1;
        const over = counts[line.product_id] > line.qty;
        beep(!over);
        say(over ? `⚠️ "${line.name}" বেশি হয়ে গেছে (${bn(counts[line.product_id])} / ${bn(line.qty)})` : `✔ ${line.name}`, over ? 'bad' : 'ok');
        verifyEl.checked = true;
        draw();
        if (allPacked()) { say('✅ সব পণ্য মিলেছে — এখন হ্যান্ডওভার চাপুন', 'ok'); if (autoEl.checked) void hand(false); }
        return;
      }
      if (up === current.code.toUpperCase()) { if (!verifyEl.checked || allPacked()) void hand(false); return; }
    }
    say('খোঁজা হচ্ছে…');
    try {
      const j = await getJSON<Lookup>(`/admin/api/handover?code=${encodeURIComponent(code)}`);
      if (!j.ok && j.product && current) { beep(false); say(`❌ "${j.product.name}" এই অর্ডারে নেই! বক্স থেকে সরান।`, 'bad'); return; }
      if (!j.ok) { beep(false); say(j.error, 'bad'); return; }
      current = j.order;
      counts = {};
      beep(true);
      draw();
      if (current.status === 'shipped') { say('এটা আগেই কুরিয়ারে দেওয়া হয়েছে।', 'bad'); return; }
      if (!current.ready) { say(`⚠️ এই অর্ডারের অবস্থা "${current.status_text}"`, 'bad'); return; }
      if (autoEl.checked && !verifyEl.checked) void hand(false);
      else say(verifyEl.checked ? 'এখন বক্সের প্রতিটা পণ্যের বারকোড স্ক্যান করুন' : 'ঠিক থাকলে "কুরিয়ারে হ্যান্ডওভার" চাপুন');
    } catch (e) { beep(false); say(current ? `❌ "${code}" — এই অর্ডারের কোনো পণ্যের সাথে মেলেনি` : (e as Error).message || 'পাওয়া যায়নি', 'bad'); }
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const v = input.value; input.value = ''; void scan(v); } });
  $('[data-ho-go]', ho)?.addEventListener('click', () => { const v = input.value; input.value = ''; void scan(v); input.focus(); });
  ho.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t.closest('[data-ho-hand]')) {
      if (verifyEl.checked && !allPacked() && !confirm('সব পণ্যের বারকোড এখনো মেলেনি। তবুও হ্যান্ডওভার করবেন?')) return;
      void hand(false);
    }
    if (t.closest('[data-ho-clear]')) { current = null; counts = {}; draw(); say(''); input.focus(); }
  });
  document.addEventListener('click', async (e) => {
    const u = (e.target as Element).closest?.('[data-ho-undo]');
    if (!u || !confirm(`${u.getAttribute('data-ho-undo')} — হ্যান্ডওভার বাতিল করে আবার "প্যাকিং চলছে" করবেন?`)) return;
    const j = await post('/admin/api/handover/undo', { code: u.getAttribute('data-ho-undo') });
    say(j.message || j.error || '', j.ok ? 'ok' : 'bad');
    if (j.ok) u.closest('tr')?.remove();
  });
  // camera
  const camBox = $('[data-ho-cambox]', ho)!;
  let stopCam: (() => void) | null = null;
  $('[data-ho-cam]', ho)?.addEventListener('click', () => {
    camBox.hidden = false;
    stopCam = startCamera($<HTMLVideoElement>('video', camBox)!, (code) => void scan(code), (err) => { say(err, 'bad'); camBox.hidden = true; });
  });
  $('[data-ho-camoff]', ho)?.addEventListener('click', () => { stopCam?.(); stopCam = null; camBox.hidden = true; input.focus(); });
  // the barcode gun types fast and presses Enter: keep the box ready
  document.addEventListener('keydown', (e) => { if (document.activeElement === document.body && /^[\w-]$/.test(e.key)) input.focus(); });
}

// ---------- 📷 scan a product barcode into a search box (inventory, products) ----------
function scanInto(): void {
  for (const btn of $all('[data-scan-into]')) {
    btn.addEventListener('click', () => {
      const target = $<HTMLInputElement>(btn.getAttribute('data-scan-into') || '');
      const video = <video playsinline="" muted="" /> as HTMLVideoElement;
      const cancel = <button type="button" className="btn btn-ghost">বাতিল</button>;
      const m = <div className="cam-modal"><div className="cam-card"><h3>📷 বারকোড স্ক্যান করুন</h3><div className="cam-view ho-cam-wide">{video}<div className="ho-aim" /></div>
        <p className="small muted">বারকোড লাল দাগ বরাবর ধরুন</p>{cancel}</div></div>;
      document.body.appendChild(m);
      const stop = startCamera(video, (code) => {
        beep(true);
        stop();
        m.remove();
        if (target) { target.value = code; target.form?.submit(); }
      }, (err) => { alert(err); stop(); m.remove(); });
      cancel.addEventListener('click', () => { stop(); m.remove(); });
    });
  }
}

export function startHandover(): void {
  try {
    const ho = $('[data-handover]');
    if (ho) handover(ho);
    scanInto();
  } catch (e) { console.error('সবমিলবে admin: handover could not start', e); }
}
