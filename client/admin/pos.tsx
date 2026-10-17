/* সবমিলবে admin — 🧾 দোকানে বিক্রি (POS): scan → bill → paid → cash memo. */
import { h, Fragment, paint } from '../jsx.js';
import { bn, getJson, postJson, whenReady, type Loose } from '../dom.js';
import { beep, startCamera } from './scan.js';

void Fragment;
type Line = { id: number; name: string; sku?: string; price: number; qty: number; here?: number };
type Found = { id: number; name: string; sku?: string; price: number; here?: number; active?: boolean; image?: string; emoji?: string };

whenReady(() => {
  const root = document.querySelector<HTMLElement>('[data-pos]');
  if (root) start(root);
});

function start(root: HTMLElement): void {
  const money = (n: unknown) => { const v = Math.round(Number(n || 0) * 100) / 100; return `${v < 0 ? '-' : ''}৳${bn(Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }))}`; };
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const input = (s: string) => $<HTMLInputElement>(s);
  const canPrice = root.getAttribute('data-can-price') === '1';
  const KEY = 'sm_pos_bill';
  let lines: Line[] = [];
  try { lines = JSON.parse(sessionStorage.getItem(KEY) || '[]') || []; } catch { lines = []; }
  const whSel = root.querySelector<HTMLSelectElement>('[data-pos-wh]');
  const msg = $('[data-pos-msg]');
  const say = (t: string, bad = false) => { msg.textContent = t; msg.className = `pos-msg ${bad ? 'warn' : 'good'}`; };
  const wh = () => (whSel ? whSel.value : '0');
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* ignore */ } };
  const doneBtn = $<HTMLButtonElement>('[data-pos-done]');

  const totals = () => {
    const sub = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const disc = Math.min(sub, Math.max(0, Number(input('[data-pos-disc]').value) || 0));
    const total = Math.max(0, Math.floor(Math.round((sub - disc) * 100) / 100 + 1e-9)); // paisa dropped as a rounding discount
    return { sub: Math.round(sub * 100) / 100, disc, total };
  };
  const render = () => {
    const body = $('[data-pos-lines]');
    if (!lines.length) paint(body, <tr><td className="muted">কোনো পণ্য নেই — বারকোড স্ক্যান করুন।</td></tr>);
    else {
      paint(body, lines.map((l, i) =>
        <tr data-i={String(i)}>
          <td><b>{l.name}</b><br /><span className="small muted">{l.sku || ''}{l.here !== undefined ? ` · এখানে আছে ${bn(l.here)}` : ''}</span>
            {l.here !== undefined && l.qty > l.here ? <><br /><span className="small warn">⚠️ স্টকের চেয়ে বেশি</span></> : null}</td>
          <td className="pos-qty"><button type="button" data-d="-1" aria-label="কমান">−</button><input type="number" min="1" value={String(l.qty)} data-qty="" aria-label="পরিমাণ" /><button type="button" data-d="1" aria-label="বাড়ান">+</button></td>
          <td className="num">{canPrice ? <input type="number" min="0" step="0.01" value={String(l.price)} data-price="" className="pos-price" aria-label="দাম" /> : money(l.price)}<br /><b>{money(l.price * l.qty)}</b></td>
          <td><button type="button" className="link-btn danger" data-rm="" aria-label="সরান">✕</button></td></tr>));
    }
    const t = totals();
    $('[data-pos-sub]').textContent = money(t.sub);
    $('[data-pos-total]').textContent = money(t.total);
    const given = Number(input('[data-pos-given]').value) || 0;
    $('[data-pos-change]').textContent = given ? (given >= t.total ? money(given - t.total) : `আরও ${money(t.total - given)} লাগবে`) : '—';
    doneBtn.disabled = !lines.length;
    doneBtn.textContent = lines.length ? `✅ বিক্রি সম্পন্ন · ${money(t.total)}` : '✅ বিক্রি সম্পন্ন ও মেমো প্রিন্ট';
    save();
  };
  const addProduct = (p: Found) => {
    if (!p.active) say(`⚠️ "${p.name}" দোকানে বন্ধ করা আছে — তবুও বিলে যোগ হলো।`, true);
    const ex = lines.find((l) => l.id === p.id);
    if (ex) ex.qty += 1;
    else lines.push({ id: p.id, name: p.name, sku: p.sku, price: p.price, qty: 1, here: p.here });
    beep(true);
    if (p.active) say(`✅ ${p.name} যোগ হয়েছে`);
    render();
  };
  const results = $('[data-pos-results]');
  let found: Found[] = [];
  const find = async (q: string) => {
    if (!q) return;
    say('খোঁজা হচ্ছে…');
    try {
      const j = await getJson<{ exact?: Found; list?: Found[] }>(`/admin/api/pos/find?q=${encodeURIComponent(q)}&wh=${wh()}`);
      paint(results);
      if (j.exact) { addProduct(j.exact); return; }
      if (!j.list?.length) { say(`"${q}" — কোনো পণ্য পাওয়া যায়নি।`, true); beep(false); return; }
      say(`${bn(j.list.length)}টি পণ্য পাওয়া গেছে — বাছুন:`);
      found = j.list;
      paint(results, j.list.map((p, i) =>
        <li><button type="button" data-pick={String(i)}>{p.image ? <img src={p.image} alt="" /> : <span>{p.emoji || '📦'}</span>}
          <span><b>{p.name}</b><br /><span className="small muted">SKU {p.sku} · স্টক {bn(p.here)}</span></span><b>{money(p.price)}</b></button></li>));
    } catch { say('খোঁজা যায়নি, আবার চেষ্টা করুন।', true); }
  };
  const q = input('[data-pos-q]');
  $('[data-pos-scan]').addEventListener('submit', (e) => { e.preventDefault(); const v = q.value.trim(); q.value = ''; void find(v); q.focus(); });
  results.addEventListener('click', (e) => {
    const b = (e.target as Element).closest('[data-pick]');
    if (!b) return;
    addProduct(found[Number(b.getAttribute('data-pick'))]);
    paint(results);
    q.focus();
  });
  const lineOf = (e: Event) => { const tr = (e.target as Element).closest('tr[data-i]'); return tr ? lines[Number(tr.getAttribute('data-i'))] : null; };
  $('[data-pos-lines]').addEventListener('click', (e) => {
    const l = lineOf(e);
    if (!l) return;
    const d = (e.target as Element).closest('[data-d]');
    if (d) { l.qty = Math.max(1, l.qty + Number(d.getAttribute('data-d'))); render(); }
    if ((e.target as Element).closest('[data-rm]')) { lines.splice(lines.indexOf(l), 1); render(); }
  });
  $('[data-pos-lines]').addEventListener('change', (e) => {
    const l = lineOf(e);
    if (!l) return;
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-qty]')) l.qty = Math.max(1, parseInt(t.value, 10) || 1);
    if (t.matches('[data-price]')) l.price = Math.max(0, Number(t.value) || 0);
    render();
  });
  for (const s of ['[data-pos-disc]', '[data-pos-given]']) $(s).addEventListener('input', render);
  whSel?.addEventListener('change', () => { lines = []; render(); say('দোকান বদলানো হয়েছে — বিল খালি করা হলো।'); });
  $('[data-pos-clear]').addEventListener('click', () => { if (!lines.length || confirm('বিল খালি করবেন?')) { lines = []; render(); } });

  // camera scanning
  let stopCam: (() => void) | null = null;
  const camBox = $('[data-pos-cam-box]');
  $('[data-pos-cam]').addEventListener('click', () => {
    camBox.hidden = false;
    stopCam = startCamera($<HTMLVideoElement>('[data-pos-video]'), (code) => void find(code), (err) => { say(err, true); camBox.hidden = true; });
  });
  $('[data-pos-cam-stop]').addEventListener('click', () => { stopCam?.(); stopCam = null; camBox.hidden = true; q.focus(); });

  // done → save the sale, open the memo
  const err = $('[data-pos-error]');
  doneBtn.addEventListener('click', async () => {
    err.hidden = true;
    const t = totals();
    const pay = root.querySelector<HTMLInputElement>('input[name=pos_pay]:checked');
    const given = Number(input('[data-pos-given]').value) || 0;
    if (pay && pay.value === 'cash' && given && given < t.total) { err.textContent = 'কাস্টমার মোট টাকার চেয়ে কম দিয়েছেন।'; err.hidden = false; return; }
    doneBtn.disabled = true;
    doneBtn.textContent = 'সেভ হচ্ছে…';
    const memoWin = window.open('about:blank', '_blank');
    try {
      const x = await postJson<Loose>('/admin/api/pos/sale', {
        items: lines.map((l) => ({ id: l.id, qty: l.qty, price: l.price })), discount: t.disc, wh: wh(),
        phone: input('[data-pos-phone]').value.trim(), name: input('[data-pos-name]').value.trim(), payment: pay ? pay.value : 'cash', given, note: input('[data-pos-note]').value.trim(),
      });
      if (!x.ok) throw new Error(x.j.error || 'সেভ হয়নি');
      const memo = `/admin/pos/memo/${x.j.id}?print=1`;
      if (memoWin) memoWin.location.href = memo; else window.open(memo, '_blank');
      say(`✅ বিক্রি সেভ হয়েছে — মেমো ${x.j.code}${x.j.change > 0 ? ` · ফেরত দিন ${money(x.j.change)}` : ''}`);
      lines = [];
      for (const s of ['[data-pos-disc]', '[data-pos-given]', '[data-pos-phone]', '[data-pos-name]', '[data-pos-note]']) input(s).value = s === '[data-pos-disc]' ? '0' : '';
      render();
      q.focus();
    } catch (e) {
      memoWin?.close();
      err.textContent = (e as Error).message;
      err.hidden = false;
      doneBtn.disabled = false;
      render();
    }
  });
  render();
}
