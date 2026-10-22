// সবমিলবে admin — what every admin page uses: messages, the save reminder, the side menu, refresh, confirmations,
// the e-mailed delete code, and many small page helpers.
import { h, Fragment, paint } from '../jsx.js';
import { $, $all, bn, hit } from '../dom.js';
import type { FraudReport } from '../api-types.js';
/** the fields every admin JSON answer may carry when something went wrong */
type Refusal = { error?: string; message?: string; rows?: unknown };

void Fragment;

let toastTimer = 0;
export function toast(text: string): void {
  const t = $('[data-toast]');
  if (!t) { alert(text); return; }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 3500);
}
/** GET the admin's JSON; a refusal (403, 500…) becomes an Error with the server's own message. */
export async function getJSON<T = unknown>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  const j = (await r.json()) as Refusal;
  if (!r.ok && !j.rows) throw new Error(j.error || j.message || 'সমস্যা হয়েছে');
  return j as unknown as T;
}
/** POST JSON to the admin; a refusal becomes an Error with the server's own message. */
export async function postJSON<T = unknown>(url: string, body: unknown, fallback = 'সমস্যা হয়েছে'): Promise<T> {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({ error: r.status === 413 ? 'ফাইলটি অনেক বড়।' : `সার্ভার থেকে উত্তর আসেনি (${r.status})।` }))) as Refusal;
  if (!r.ok) throw new Error(j.error || fallback);
  return j as unknown as T;
}
/** A form sent the classic way (urlencoded) but answered as JSON — the small "save at once" switches. */
export async function postForm<T = unknown>(url: string, body: URLSearchParams, fallback = 'সেভ হয়নি'): Promise<T> {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  const j = (await r.json().catch(() => { throw new Error('সেভ হয়নি — পেজটা রিফ্রেশ করে আবার চেষ্টা করুন।'); })) as Refusal;
  if (!r.ok) throw new Error(j.error || fallback);
  return j as unknown as T;
}
export const money = (n: unknown): string => {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const a = Math.abs(v);
  const t = Math.abs(a - Math.round(a)) < 0.005 ? Math.round(a).toLocaleString('en-IN') : a.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}৳${bn(t)}`;
};
export const show = (el: HTMLElement | null | undefined, on: boolean): void => { if (el) el.hidden = !on; };
const field = (f: HTMLFormElement, name: string) => f.elements.namedItem(name) as HTMLInputElement | null;

// ---------- 💾 every change waits for a clear "সেভ করুন" press ----------
// Switches and boxes don't save on their own: the form's save button lights up, and a bar at the
// bottom of the screen reminds that something is changed but not saved yet. Nothing is lost by mistake.
type SaveButton = HTMLButtonElement | HTMLInputElement;
function isSaveBtn(b: SaveButton | null): boolean {
  if (!b || (b.disabled && !b.hasAttribute('data-auto-save-btn'))) return false;
  if (b.type === 'button' || b.type === 'reset' || b.name === 'delete' || b.classList.contains('danger') || b.classList.contains('btn-danger')) return false;
  return /সেভ|save|আপডেট|সংরক্ষণ/i.test(b.textContent || b.value || '');
}
function saveBtnOf(f: HTMLFormElement): SaveButton | null {
  const own = f.querySelector<SaveButton>('[data-auto-save-btn]');
  if (own) return own;
  let list = $all<SaveButton>('button, input[type="submit"]', f).filter(isSaveBtn);
  if (!list.length && f.id) list = $all<SaveButton>(`button[form="${f.id}"], input[type="submit"][form="${f.id}"]`).filter(isSaveBtn);
  return list[0] || null;
}
let saveBar: HTMLElement | null = null;
let changedForm: HTMLFormElement | null = null;
export function markChanged(f: HTMLFormElement): void {
  const b = saveBtnOf(f);
  if (!b) return;
  f.setAttribute('data-changed', '1');
  if (b.hasAttribute('data-auto-save-btn')) { b.disabled = false; f.setAttribute('data-dirty', '1'); }
  b.classList.add('needs-save');
  changedForm = f;
  saveBar?.classList.add('show');
}
function saveReminder(): void {
  // forms whose switches used to save by themselves get their own save button
  for (const el of $all<HTMLInputElement>('[data-autosubmit]')) {
    const f = el.form || el.closest('form');
    if (!f || f.getAttribute('method') === 'get' || f.querySelector('[data-auto-save-btn]')) continue;
    f.appendChild(<div className="auto-save-row"><button type="submit" className="btn btn-sm auto-save-btn" data-auto-save-btn="" disabled>💾 সেভ করুন</button>
      <span className="muted small auto-save-note">বদল করার পর এই বাটন চাপলে তবেই সেভ হবে</span></div>);
  }
  saveBar = <div className="save-bar" role="status"><span>⚠️ আপনি কিছু বদলেছেন — এখনো <b>সেভ হয়নি</b></span><button type="button" className="btn btn-sm" data-save-bar-go="">💾 সেভ করুন</button></div>;
  document.body.appendChild(saveBar);
  const watch = (e: Event) => {
    const t = e.target as HTMLInputElement | null;
    if (!e.isTrusted || !t?.closest?.('#main')) return;
    if (t.closest('[data-prod-toggle], [data-check-row], [data-check-all], [data-no-dirty]') || t.type === 'search' || t.type === 'file') return;
    const f = t.form || t.closest('form');
    if (!f || (f.getAttribute('method') || 'get').toLowerCase() !== 'post' || f.hasAttribute('data-no-dirty') || f.hasAttribute('data-ui-text')) return;
    markChanged(f);
  };
  document.addEventListener('change', watch);
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement | null;
    if (t && /INPUT|TEXTAREA/.test(t.tagName) && t.type !== 'checkbox' && t.type !== 'radio') watch(e);
  });
  $('[data-save-bar-go]', saveBar)!.addEventListener('click', () => {
    const f = changedForm && document.body.contains(changedForm) ? changedForm : $<HTMLFormElement>('form[data-changed="1"]');
    if (!f) { saveBar?.classList.remove('show'); return; }
    const b = saveBtnOf(f);
    if (f.requestSubmit) f.requestSubmit(b && b.form === f ? b : undefined); else if (b) b.click(); else f.submit();
  });
  // a form with an unsent change: the browser asks before leaving
  window.addEventListener('beforeunload', (e) => {
    if (document.querySelector('form[data-dirty="1"]:not([data-submitting])')) { e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('submit', (e) => { (e.target as Element)?.setAttribute?.('data-submitting', '1'); }, true);
}

// ---------- 🔄 রিফ্রেশ: lists and reports get a button that loads this page's newest data ----------
// (a new order or a change from another device shows at once — no need to reload the whole browser)
const REFRESH_PAGES = /^\/admin(\/orders(\/incomplete)?|\/customers|\/products|\/inventory|\/purchases|\/suppliers|\/reports(\/[a-z-]+)?|\/marketing\/visitors(\/[a-z-]+)?|\/research|\/reach|\/growth|\/accounts(\/[a-z]+)?|\/reviews|\/blocklist)?\/?$/;
function refreshButton(): void {
  if (!REFRESH_PAGES.test(location.pathname)) return;
  const main = $('#main');
  let head = main && ($('.title-row', main) || $('h1', main));
  if (!head) return;
  const btn = <button type="button" className="btn btn-ghost btn-sm refresh-btn" title="এই পেজের সব তথ্য নতুন করে আনুন"><span className="refresh-ic" aria-hidden="true">🔄</span> রিফ্রেশ</button> as HTMLButtonElement;
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.classList.add('spinning');
    try { sessionStorage.setItem('sm_refresh_y', String(window.scrollY || 0)); } catch { /* ignore */ }
    location.reload();
  });
  if (head.tagName === 'H1') { const row = <div className="title-row" />; head.before(row); row.appendChild(head); head = row; }
  const place = <div className="refresh-wrap">{btn}</div>;
  const h1 = head.querySelector('h1');
  if (h1?.nextSibling) h1.after(place); else head.appendChild(place);
  // after a refresh, come back to the same spot on the page
  try { const y = sessionStorage.getItem('sm_refresh_y'); if (y) { sessionStorage.removeItem('sm_refresh_y'); window.scrollTo(0, Number(y) || 0); } } catch { /* ignore */ }
  // a page shown again from the browser's memory (back button, phone woke up) may be old — load it fresh
  window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    const busy = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (hiddenAt && Date.now() - hiddenAt > 120000 && !busy && !document.querySelector('[data-dirty], [data-changed]')) location.reload();
  });
}

// ---------- side menu ----------
function sideMenu(): void {
  // ☰ phones: slides over the page; bigger screens: hides it so the page gets the whole width (remembered)
  const narrow = () => window.matchMedia('(max-width: 900px)').matches;
  const body = document.body.classList;
  const setHidden = (on: boolean) => { body.toggle('side-hidden', on); try { localStorage.setItem('sm_side_hidden', on ? '1' : '0'); } catch { /* ignore */ } };
  document.addEventListener('click', (e) => {
    if (hit(e, '[data-side-toggle]')) { if (narrow()) body.toggle('side-open'); else setHidden(!body.contains('side-hidden')); }
    else if (hit(e, '[data-side-open]')) body.add('side-open');
    else if (hit(e, '[data-side-close]')) body.remove('side-open');
    else if (narrow() && hit(e, '.side a[href]')) body.remove('side-open');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') body.remove('side-open'); });
  // groups: remember which ones are open
  const KEY = 'sm_side_open';
  const groups = $all<HTMLDetailsElement>('[data-side-group]');
  if (!groups.length) return;
  let saved: string[] = [];
  try { saved = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch { saved = []; }
  for (const g of groups) if (saved.includes(g.getAttribute('data-side-group') || '')) g.open = true;
  for (const g of groups) {
    g.addEventListener('toggle', () => {
      const open = groups.filter((x) => x.open).map((x) => x.getAttribute('data-side-group'));
      try { localStorage.setItem(KEY, JSON.stringify(open)); } catch { /* ignore */ }
    });
  }
  $('.side a.on')?.scrollIntoView({ block: 'nearest' });
}

// ---------- confirmations and the 🔐 delete code ----------
function confirmations(): void {
  for (const f of $all<HTMLFormElement>('form[data-confirm]')) f.addEventListener('submit', (e) => { if (!confirm(f.getAttribute('data-confirm') || '')) e.preventDefault(); });
  document.addEventListener('click', (e) => {
    const b = hit(e, '[data-confirm-btn]');
    if (b && !confirm(b.getAttribute('data-confirm-btn') || '')) e.preventDefault();
  });
  // A form (or its submit button) with data-delcode="action" opens this box instead of sending; the code goes in a
  // hidden del_code field and the form is sent with the button that was pressed. Restoring etc. never asks.
  const passed = new WeakSet<HTMLFormElement>();
  document.addEventListener('submit', (e) => {
    const f = e.target as HTMLFormElement | null;
    if (e.defaultPrevented || !f || passed.has(f)) return;
    const btn = (e as SubmitEvent).submitter as HTMLButtonElement | null;
    const host = btn?.hasAttribute('data-delcode') ? btn : f.hasAttribute('data-delcode') ? f : null;
    if (!host) return;
    e.preventDefault();
    openDelCode(f, btn, host, () => passed.add(f));
  });
}
function openDelCode(form: HTMLFormElement, btn: HTMLButtonElement | null, host: Element, pass: () => void): void {
  const attr = (k: string) => host.getAttribute(k);
  const action = attr('data-delcode');
  const to = attr('data-delcode-to') || '';
  const what = attr('data-delcode-what') || '';
  // a code-protected action that isn't a delete (e.g. seeing the secret key) brings its own words
  const custom = host.hasAttribute('data-delcode-title');
  const dlg = (
    <dialog className="delcode-dlg"><form method="dialog" className="form delcode-box">
      <h2>{attr('data-delcode-title') || '🔐 মোছার কোড'}</h2>
      <p className="small">{attr('data-delcode-intro') || 'স্থায়ীভাবে মোছার আগে একটা কোড লাগবে। কোড যাবে এই ইমেইলে:'}</p>
      <p className="delcode-to"><b>{to}</b></p>
      {what ? <p className="small muted">{custom ? 'যা হবে: ' : 'যা মুছবে: '}{what}</p> : null}
      <p><button type="button" className="btn btn-sm" data-dc-send="">📧 কোড পাঠান</button></p>
      <p className="small" data-dc-msg="" role="status" />
      <label className="field"><span className="label">ইমেইলে আসা ৬ সংখ্যার কোড</span>
        <input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9০-৯]{6}" placeholder="••••••" className="delcode-input" data-dc-code="" /></label>
      <div className="row-actions"><button type="button" className={`btn ${host.hasAttribute('data-delcode-go') ? '' : 'btn-danger'}`} data-dc-go="" disabled>{attr('data-delcode-go') || '🗑️ মুছে ফেলুন'}</button>
        <button type="button" className="btn btn-ghost" data-dc-cancel="">বাতিল</button></div></form></dialog>
  ) as HTMLDialogElement;
  document.body.appendChild(dlg);
  const msg = $('[data-dc-msg]', dlg)!;
  const code = $<HTMLInputElement>('[data-dc-code]', dlg)!;
  const go = $<HTMLButtonElement>('[data-dc-go]', dlg)!;
  const send = $<HTMLButtonElement>('[data-dc-send]', dlg)!;
  const close = () => { try { dlg.close(); } catch { /* old browser */ } dlg.remove(); };
  code.addEventListener('input', () => { go.disabled = (code.value || '').replace(/[^\d০-৯]/g, '').length !== 6; });
  $('[data-dc-cancel]', dlg)!.addEventListener('click', close);
  dlg.addEventListener('cancel', () => setTimeout(close, 0));
  send.addEventListener('click', async () => {
    send.disabled = true;
    msg.className = 'small';
    msg.textContent = 'পাঠানো হচ্ছে…';
    try {
      const r = await fetch('/admin/api/delete-code', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, detail: what }) });
      const j = (await r.json()) as { ok?: boolean; to?: string; minutes?: number; error?: string }; // lib/services/delcode.ts
      if (j.error) { msg.className = 'small warn'; msg.textContent = j.error; send.disabled = false; return; }
      msg.className = 'small good';
      msg.textContent = `✅ কোড পাঠানো হয়েছে ${j.to || to} ঠিকানায়। ${bn(j.minutes || 10)} মিনিট চলবে। না এলে Spam ফোল্ডার দেখুন।`;
      send.textContent = '🔁 আবার কোড পাঠান';
      setTimeout(() => { send.disabled = false; }, 45000);
      code.focus();
    } catch { msg.className = 'small warn'; msg.textContent = 'ইন্টারনেট সমস্যা — আবার চেষ্টা করুন।'; send.disabled = false; }
  });
  go.addEventListener('click', () => {
    let hid = form.querySelector<HTMLInputElement>('input[name="del_code"]');
    if (!hid) { hid = <input type="hidden" name="del_code" /> as HTMLInputElement; form.appendChild(hid); }
    hid.value = code.value;
    // keep which button was pressed (e.g. form=purge), since form.submit() doesn't send it
    if (btn?.name) form.appendChild(<input type="hidden" name={btn.name} value={btn.value} />);
    pass();
    close();
    HTMLFormElement.prototype.submit.call(form);
  });
  code.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); if (!go.disabled) go.click(); } });
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}

// ---------- small helpers on many pages ----------
function smallHelpers(): void {
  // DNS record form: show only the boxes the chosen type needs
  const dnsForm = $<HTMLFormElement>('[data-dns-form]');
  if (dnsForm) {
    const sel = $<HTMLSelectElement>('[data-dns-type]', dnsForm)!;
    const help = $('[data-dns-help]', dnsForm);
    let texts: Record<string, string> = {};
    try { texts = JSON.parse(dnsForm.getAttribute('data-help') || '{}'); } catch { /* ignore */ }
    const HINT: Record<string, string> = { A: '76.76.21.21', AAAA: '2001:db8::1', CNAME: 'cname.vercel-dns.com', MX: 'mail.example.com', TXT: 'google-site-verification=…', NS: 'ns1.example.com', CAA: '0 issue "letsencrypt.org"' };
    const draw = () => {
      const t = sel.value;
      for (const el of $all('[data-dns-show]', dnsForm)) {
        const on = (el.getAttribute('data-dns-show') || '').split(' ').includes(t);
        el.hidden = !on;
        for (const i of $all<HTMLInputElement>('input, textarea, select', el)) i.disabled = !on;
      }
      if (help) help.textContent = texts[t] || '';
      const c = field(dnsForm, 'content');
      if (c) c.placeholder = HINT[t] || '';
      const name = field(dnsForm, 'name');
      if (t === 'SRV' && name?.value === '@') name.value = '_sip._tcp';
    };
    sel.addEventListener('change', draw);
    draw();
  }
  // অটো কল: sample messages fill the message box
  document.addEventListener('click', (e) => {
    const b = hit(e, '[data-ac-preset]');
    const t = b && $<HTMLTextAreaElement>('[data-ac-msg]');
    if (!b || !t) return;
    t.value = b.getAttribute('data-ac-preset') || '';
    if (t.form) markChanged(t.form);
    t.focus();
  });
  // product warranty: "নিজে লিখুন" shows a text box
  document.addEventListener('change', (e) => {
    const sel = hit<HTMLSelectElement>(e, '[data-warranty-sel]');
    const box = sel && $('[data-warranty-custom]', sel.closest('[data-warranty]'));
    if (!sel || !box) return;
    box.hidden = sel.value !== 'custom';
    if (!box.hidden) $('input', box)?.focus();
  });
  // running slider: live preview on its admin page
  for (const box of $all('[data-sl-preview]')) {
    const track = $('.sl-track', box);
    const n = track ? track.children.length : 0;
    if (!track || n < 2) continue;
    let k = 0;
    setInterval(() => {
      k = (k + 1) % n;
      if (box.classList.contains('fx-fade')) $all('img', track).forEach((im, j) => { im.style.opacity = j === k ? '1' : '0'; });
      else track.style.transform = `translateX(-${k * 100}%)`;
    }, (Number(box.getAttribute('data-interval')) || 4) * 1000);
  }
  // ইনভয়েস ও চেকলিস্ট: the sample beside the form follows every change at once
  const docForm = $<HTMLFormElement>('[data-doc-form]');
  const frame = $<HTMLIFrameElement>('[data-doc-preview]');
  if (docForm && frame) {
    let t = 0;
    let n = 0;
    frame.addEventListener('load', () => {
      try { const d = frame.contentDocument; if (d?.body) frame.style.height = `${Math.max(400, d.documentElement.scrollHeight + 10)}px`; } catch { /* ignore */ }
    });
    const redraw = async () => {
      const my = ++n;
      const body = new URLSearchParams(new FormData(docForm) as unknown as Record<string, string>);
      body.delete('reset');
      try {
        const r = await fetch(`${location.pathname}/preview`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        const html = r.ok ? await r.text() : null;
        if (html && my === n) frame.srcdoc = html;
      } catch { /* keep the old sample */ }
    };
    docForm.addEventListener('input', () => { clearTimeout(t); t = window.setTimeout(redraw, 450); });
    docForm.addEventListener('change', () => { clearTimeout(t); t = window.setTimeout(redraw, 150); });
  }
  // "select all" box for row checkboxes
  document.addEventListener('change', (e) => {
    const all = hit<HTMLInputElement>(e, '[data-check-all]');
    if (all) for (const c of $all<HTMLInputElement>('[data-check-row]', all.form || document)) c.checked = all.checked;
  });
  // table rows that open a details page
  document.addEventListener('click', (e) => {
    const row = hit(e, 'tr[data-href]');
    if (row && !hit(e, 'a, button, input, select, label')) location.href = row.getAttribute('data-href') || '';
  });
  // owner-only secrets (e.g. the backup password): hidden until "দেখুন" is pressed
  for (const b of $all('[data-reveal-btn]')) {
    b.addEventListener('click', () => {
      const c = b.parentElement?.querySelector('[data-reveal]');
      if (!c) return;
      const shown = c.getAttribute('data-shown') === '1';
      c.textContent = shown ? '••••••••••••••••' : c.getAttribute('data-reveal');
      c.setAttribute('data-shown', shown ? '0' : '1');
      b.textContent = shown ? '👁️ দেখুন' : '🙈 লুকান';
    });
  }
  // click-to-copy for codes
  document.addEventListener('click', (e) => {
    const c = hit(e, 'code.copy');
    if (c && navigator.clipboard) navigator.clipboard.writeText((c.textContent || '').trim()).then(() => toast('কপি হয়েছে')).catch(() => {});
  });
  // inventory: + / − buttons beside the stock change box
  const markStep = (inp: HTMLInputElement) => {
    const v = Number(inp.value) || 0;
    inp.classList.toggle('changed-up', v > 0);
    inp.classList.toggle('changed-down', v < 0);
  };
  document.addEventListener('click', (e) => {
    const b = hit(e, '[data-step]');
    const inp = b && $<HTMLInputElement>('[data-step-input]', b.closest('.stepper'));
    if (!b || !inp) return;
    const v = (Number(inp.value) || 0) + Number(b.getAttribute('data-step'));
    inp.value = v === 0 ? '' : String(v);
    markStep(inp);
    if (inp.form) markChanged(inp.form);
  });
  document.addEventListener('input', (e) => { const t = e.target as HTMLInputElement; if (t.matches?.('[data-step-input]')) markStep(t); });
  // repeat rows (links, verification files)
  document.addEventListener('click', (e) => {
    const b = hit(e, '[data-repeat-add]');
    const box = b && $(`[data-repeat="${b.getAttribute('data-repeat-add')}"]`);
    const last = box?.lastElementChild;
    if (!box || !last) return;
    const copy = last.cloneNode(true) as Element;
    for (const i of $all<HTMLInputElement>('input, textarea', copy)) i.value = '';
    for (const s of $all<HTMLSelectElement>('select', copy)) s.selectedIndex = 0;
    box.appendChild(copy);
  });
  // home sections order
  for (const ul of $all('[data-sortable]')) {
    ul.addEventListener('click', (e) => {
      const li = hit(e, 'li');
      if (!li) return;
      if (hit(e, '[data-up]') && li.previousElementSibling) li.previousElementSibling.before(li);
      if (hit(e, '[data-down]') && li.nextElementSibling) li.nextElementSibling.after(li);
    });
  }
  // category icon grid
  let lastIcon: HTMLInputElement | null = null;
  document.addEventListener('focusin', (e) => { const t = e.target as HTMLInputElement; if (t.hasAttribute?.('data-icon-input')) lastIcon = t; });
  document.addEventListener('click', (e) => {
    const b = hit(e, '[data-icon]');
    const target = b && (lastIcon || $<HTMLInputElement>('[data-icon-input]'));
    if (b && target) { target.value = b.getAttribute('data-icon') || ''; target.focus(); }
  });
  // staff permission presets
  document.addEventListener('click', (e) => {
    const b = hit(e, '[data-preset]');
    if (!b) return;
    const want = (b.getAttribute('data-preset') || '').split(',');
    for (const c of $all<HTMLInputElement>('[data-perms] input[type=checkbox]')) c.checked = want.includes(c.value);
  });
  // SEO preview & counters
  for (const el of $all<HTMLInputElement>('[data-count]')) {
    const max = Number(el.getAttribute('data-count'));
    const c = <small className="counter" />;
    el.parentElement?.appendChild(c);
    const f = () => {
      c.textContent = `${bn(el.value.length)} / ${bn(max)}`;
      c.classList.toggle('warn', el.value.length > max);
      if (el.name === 'seo_title') { const t = $('[data-serp-title]'); if (t) t.textContent = el.value || el.placeholder; }
      if (el.name === 'seo_description') { const d = $('[data-serp-desc]'); if (d) d.textContent = el.value || el.placeholder; }
    };
    el.addEventListener('input', f);
    f();
  }
}

// ---------- pages that refresh themselves ----------
function liveParts(): void {
  // A part marked data-live-refresh is fetched again every few seconds and swapped in place (no page flash).
  const liveBox = $('[data-live-refresh]');
  if (liveBox) {
    let busy = false;
    setInterval(async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const r = await fetch(location.href, { credentials: 'same-origin', headers: { 'X-Live': '1' } });
        const t = r.ok ? await r.text() : '';
        if (t) {
          const doc = new DOMParser().parseFromString(t, 'text/html');
          for (const sel of ['[data-live-refresh]', '.va-tabs']) {
            const fresh = doc.querySelector(sel);
            const cur = document.querySelector(sel);
            if (fresh && cur && fresh.innerHTML !== cur.innerHTML) cur.replaceChildren(...Array.from(fresh.childNodes).map((n) => document.importNode(n, true)));
          }
        }
      } catch { /* next time */ }
      busy = false;
    }, (Number(liveBox.getAttribute('data-live-refresh')) || 5) * 1000);
  }
  const auto = $('[data-autoreload]');
  if (auto) setInterval(() => { if (document.visibilityState === 'visible') location.reload(); }, (Number(auto.getAttribute('data-autoreload')) || 30) * 1000);
}

// ---------- switches that save at once ----------
function instantSaves(): void {
  // product list: show / hide switch (saves right away, no page reload)
  document.addEventListener('change', async (e) => {
    const t = hit<HTMLInputElement>(e, '[data-prod-toggle]');
    const f = t?.form;
    if (!t || !f) return;
    const txt = $('[data-prod-toggle-text]', f);
    const on = t.checked;
    t.disabled = true;
    const body = new URLSearchParams();
    if (on) body.set('active', '1');
    try {
      await postForm(f.action, body);
      if (txt) txt.textContent = on ? 'চালু' : 'বন্ধ';
      f.closest('tr')?.classList.toggle('row-off', !on);
      toast(on ? f.getAttribute('data-on') || 'পণ্যটি দোকানে আবার দেখাচ্ছে' : f.getAttribute('data-off') || 'পণ্যটি দোকান থেকে লুকানো হয়েছে');
      f.closest('.ui-row')?.classList.toggle('row-off', !on);
    } catch (err) { t.checked = !on; toast((err as Error).message); }
    t.disabled = false;
  });
  // 🚩 অন্য দোকানের ছবি: "watermark / clean" saves at once, the card changes colour
  document.addEventListener('click', async (e) => {
    const b = hit<HTMLButtonElement>(e, '[data-srcpic] button[name="flag"]');
    const f = b?.form;
    if (!b || !f) return;
    e.preventDefault();
    const card = f.closest('.srcpic');
    const state = $('[data-srcpic-state]', f);
    const body = new URLSearchParams(new FormData(f) as unknown as Record<string, string>);
    body.set('flag', b.value);
    const buttons = $all<HTMLButtonElement>('button', f);
    for (const x of buttons) x.disabled = true;
    try {
      // getAttribute: the form has a field named "action", which hides the form's own .action address
      const j = await postForm<{ flag: boolean }>(f.getAttribute('action') || '', body);
      card?.classList.toggle('is-flag', j.flag);
      card?.classList.toggle('is-clean', !j.flag);
      if (state) state.textContent = j.flag ? '🚩 চিহ্নিত' : '✅ পরিষ্কার';
      card?.nextElementSibling?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) { toast((err as Error).message); }
    for (const x of buttons) x.disabled = false;
  });
  // shop texts (দোকানে কী দেখাবে): save without leaving the page
  for (const f of $all<HTMLFormElement>('[data-ui-text]')) {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $<HTMLButtonElement>('button', f)!;
      btn.disabled = true;
      try { await postForm(f.action, new URLSearchParams(new FormData(f) as unknown as Record<string, string>)); toast('✅ লেখা সেভ হয়েছে'); } catch (err) { toast((err as Error).message); }
      btn.disabled = false;
    });
  }
  // 🎨 variants page: on/off switch per row, add a row
  const vform = $('[data-var-form]');
  if (vform) {
    vform.addEventListener('change', (e) => {
      const sw = hit<HTMLInputElement>(e, '[data-var-active]');
      const row = sw?.closest('tr');
      if (!sw || !row) return;
      const hv = $<HTMLInputElement>('[data-var-active-val]', row);
      if (hv) hv.value = sw.checked ? '1' : '0';
      row.classList.toggle('row-off', !sw.checked);
    });
    const vadd = $('[data-var-add]');
    // the blank row is kept in a hidden table (not a <template>: React must be able to take the page over)
    const vtpl = $('[data-var-template] tr');
    const vbody = $('[data-var-body]');
    if (vadd && vtpl && vbody) vadd.addEventListener('click', () => { vbody.appendChild(vtpl.cloneNode(true)); $all<HTMLInputElement>('input[name=vlabel]', vbody).at(-1)?.focus(); });
  }
}

// ---------- order lists and product lists: tick many, one action for all; fraud check ----------
function lists(): void {
  const bulk = $<HTMLFormElement>('[data-bulk]');
  if (bulk) {
    const bar = $('[data-bulk-bar]', bulk);
    const all = $<HTMLInputElement>('[data-check-all]', bulk);
    const upd = () => {
      const n = $all('input[name="ids[]"]:checked', bulk).length;
      if (bar) { bar.hidden = n === 0; const c = $('[data-bulk-count]', bar); if (c) c.textContent = bn(n); }
    };
    all?.addEventListener('change', () => { for (const c of $all<HTMLInputElement>('input[name="ids[]"]', bulk)) c.checked = all.checked; upd(); });
    bulk.addEventListener('change', upd);
    bulk.addEventListener('submit', (e) => {
      const btn = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      if (btn?.value === 'courier' && !confirm('বাছাই করা অর্ডারগুলো কুরিয়ারে পাঠাবেন?')) e.preventDefault();
    });
  }
  const pb = $<HTMLFormElement>('[data-pbulk]');
  if (pb) {
    const rows = () => $all<HTMLInputElement>('[data-pbulk-row]');
    const ticked = () => rows().filter((c) => c.checked).length;
    const upd = () => { const n = ticked(); pb.hidden = n === 0; const c = $('[data-pbulk-count]', pb); if (c) c.textContent = bn(n); };
    const pbAll = $<HTMLInputElement>('[data-pbulk-all]');
    pbAll?.addEventListener('change', () => { for (const c of rows()) c.checked = pbAll.checked; upd(); });
    document.addEventListener('change', (e) => { if (hit(e, '[data-pbulk-row]')) upd(); });
    const act = $<HTMLSelectElement>('[data-pbulk-action]', pb)!;
    const showFor = () => {
      for (const el of $all('[data-pbulk-for]', pb)) {
        const on = (el.getAttribute('data-pbulk-for') || '').split(' ').includes(act.value);
        el.hidden = !on;
        for (const i of $all<HTMLInputElement>('input,select', el)) i.disabled = !on;
      }
    };
    act.addEventListener('change', showFor);
    showFor();
    $('[data-pbulk-clear]', pb)?.addEventListener('click', () => { for (const c of rows()) c.checked = false; if (pbAll) pbAll.checked = false; upd(); });
    pb.addEventListener('submit', (e) => {
      const label = act.options[act.selectedIndex]?.text || '';
      if (!confirm(`${bn(ticked())}টি পণ্যে "${label}" করবেন?${act.value === 'delete' ? ' (রিসাইকেল বিনে থাকবে)' : ''}`)) e.preventDefault();
    });
  }
  // fraud check
  document.addEventListener('click', async (e) => {
    const b = hit(e, '[data-fraud-check]');
    if (!b) return;
    const out = b.closest('[data-fraud-out]') || b.parentElement?.querySelector('[data-fraud-out]');
    if (!out) return;
    out.textContent = 'চেক করা হচ্ছে…';
    try {
      const j = await getJSON<FraudReport>(`/admin/api/fraud?phone=${encodeURIComponent(b.getAttribute('data-fraud-check') || '')}${b.hasAttribute('data-fresh') ? '&fresh=1' : ''}`);
      if (!j.ok) { out.textContent = j.message || 'তথ্য পাওয়া যায়নি'; return; }
      const o = j.own;
      const rows: Node[] = [<li>🏪 এই দোকানে: ডেলিভারি <b>{bn(o.delivered || 0)}</b> · বাতিল/ফেরত <b>{bn(o.failed || 0)}</b>{o.open ? ` · চলমান ${bn(o.open)}` : ''}</li>];
      if (j.fraudbd?.ok) {
        for (const c of j.fraudbd.couriers || []) {
          rows.push(<li>🚚 {c.name}: {c.type === 'rating' ? c.message || c.rating || '—' : <>মোট <b>{bn(c.total)}</b> · সফল <b>{bn(c.success)}</b> · বাতিল <b>{bn(c.cancel)}</b></>}</li>);
        }
      } else if (j.fraudbd && !j.fraudbd.ok) rows.push(<li className="muted">FraudBD: {j.fraudbd.message || ''}</li>);
      if (j.pathao?.ok && !j.fraudbd?.ok) rows.push(<li>🚚 Pathao: মোট <b>{bn(j.pathao.total)}</b> · সফল <b>{bn(j.pathao.success)}</b>{j.pathao.rating ? ` · ${j.pathao.rating}` : ''}</li>);
      else if (j.pathao && !j.pathao.ok) rows.push(<li className="muted">Pathao: {j.pathao.message || ''}</li>);
      if (!j.sources.fraudbd && !j.sources.pathao) rows.push(<li className="muted">অন্য দোকানের রেকর্ড দেখতে <a href="/admin/fraud">ফ্রড চেক সেটিংস</a> এ FraudBD API key দিন।</li>);
      paint(out,
        <div className={`risk risk-${j.level}`}><b>{j.label}</b>{j.rate !== null ? <> — সব মিলিয়ে সফল <b>{bn(j.rate)}%</b> ({bn(j.success)}/{bn(j.total)})</> : null}<span>{j.advice}</span></div>,
        <ul className="fraud-list">{rows}</ul>,
        j.cached_at ? <p className="muted">আগের চেক থেকে (২৪ ঘণ্টার মধ্যে) — <button type="button" className="link-btn small" data-fraud-check={j.phone} data-fresh="">আবার চেক করুন</button></p> : null);
    } catch (err) { out.textContent = (err as Error).message; }
  });
}

// ---------- step-by-step jobs started by a button ----------
function jobs(): void {
  // market research: "এখনই আপডেট করুন" reads every shop once, one per call
  const rsBtn = $<HTMLButtonElement>('[data-rs-run]');
  rsBtn?.addEventListener('click', async () => {
    const msg = $('[data-rs-msg]')!;
    const seen = new Set<string>();
    rsBtn.disabled = true;
    try {
      for (let done = 0; done < 30; done++) {
        const r = await fetch('/admin/api/research/run', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
        // lib/services/research.ts: one shop read, or idle (nothing due) / skipped (another run just now)
        const j = (await r.json()) as { idle?: boolean; skipped?: boolean; source?: string; items?: number; pages?: number; error?: string };
        if (j.idle || !j.source || seen.has(j.source)) break;
        seen.add(j.source);
        msg.textContent = `⏳ ${j.source}${j.error ? ` — ${j.error}` : ` — ${bn(j.items || 0)}টি পণ্য পড়া হলো`}`;
      }
      msg.textContent = '✅ আপডেট শেষ — পেজ আবার লোড হচ্ছে…';
      setTimeout(() => location.reload(), 900);
    } catch { msg.textContent = 'আপডেট করা যায়নি, একটু পরে চেষ্টা করুন।'; rsBtn.disabled = false; }
  });
  // market research → search every shop by name: it takes a few seconds, say so
  const rsFind = $<HTMLFormElement>('[data-rs-find]');
  rsFind?.addEventListener('submit', () => {
    const m = $('[data-rs-find-msg]', rsFind);
    const b = $<HTMLButtonElement>('button', rsFind);
    if (m) m.textContent = '⏳ সব দোকানে খুঁজছি… (২০–২৫ সেকেন্ড)';
    if (b) setTimeout(() => { b.disabled = true; }, 0);
  });
  // ভাষা (বাংলা / English): "এখনই সব অনুবাদ করে রাখুন" — one batch per call until nothing is left
  const i18nBtn = $<HTMLButtonElement>('[data-i18n-fill]');
  i18nBtn?.addEventListener('click', async () => {
    const prog = $('[data-i18n-progress]')!;
    i18nBtn.disabled = true;
    try {
      for (let rounds = 0; rounds < 200; rounds++) {
        const r = await fetch('/admin/design/language/fill', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { total: number; done: number; left: number; error?: string }; // lib/services/translate.ts
        prog.textContent = `⏳ ${bn(j.total - j.left)} / ${bn(j.total)} টি লেখা অনুবাদ হয়েছে…`;
        if (j.error && !j.done) throw new Error(j.error);
        if (!(j.left > 0 && j.done > 0)) break;
      }
      prog.textContent = '✅ সব অনুবাদ হয়ে গেছে — পেজ আবার লোড হচ্ছে…';
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      prog.textContent = `⚠️ ${(e as Error)?.message || 'অনুবাদ করা যায়নি'} — একটু পরে আবার চেষ্টা করুন।`;
      i18nBtn.disabled = false;
    }
  });
}

// 🖼️ Tap a small product picture in any admin list to see it big (the full-size picture, not the thumbnail).
function zoomPictures(): void {
  const SMALL = '.table .thumb img, .inv-table .thumb img, .lines .li-pic img, .restock-table .thumb img, .review-admin .thumb img, .qa-head .thumb img, .bundle-rows .b-img img, .ho-items img, .picker-results img, .ss-head img';
  for (const im of $all(SMALL)) im.setAttribute('data-zoomable', '');
  let open: HTMLElement | null = null;
  const close = () => { open?.remove(); open = null; document.removeEventListener('keydown', onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('click', (e) => {
    const im = hit<HTMLImageElement>(e, 'img');
    if (!im || !im.matches(SMALL) || im.closest('a, button, label')) return; // picture is itself a link/button: keep its own job
    e.preventDefault();
    const big = <img alt={im.alt || ''} src={(im.currentSrc || im.src).replace(/(\/media\/[^/?#]+)\/t(\b|$)/, '$1')} /> as HTMLImageElement;
    big.addEventListener('error', () => { big.src = im.src; }, { once: true });
    const x = <button type="button" aria-label="বন্ধ করুন">✕</button>;
    open = <div className="pic-zoom" role="dialog" aria-modal="true">{big}{x}</div>;
    open.addEventListener('click', close);
    document.body.appendChild(open);
    document.addEventListener('keydown', onKey);
    x.focus();
  });
}

// 📐 Two columns of different length (a long form beside a short box): the short one follows while the page scrolls, so
// the page has no big empty half. A short column taller than the screen first scrolls to its end, then stays.
// Never on phones (one column there).
function stickySides(): void {
  const rows = $all<HTMLElement>('#main .two-col');
  if (!rows.length || typeof ResizeObserver === 'undefined') return;
  const check = () => {
    const wide = window.matchMedia('(min-width: 901px)').matches;
    for (const row of rows) {
      const cols = [...row.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
      for (const c of cols) { c.classList.remove('is-sticky'); c.style.top = ''; }
      if (!wide || cols.length !== 2) continue;
      const [a, b] = cols.map((c) => c.getBoundingClientRect().height);
      const short = a < b ? cols[0] : cols[1];
      if (Math.abs(a - b) <= 160) continue;
      short.classList.add('is-sticky');
      // taller than the screen: it scrolls with the page until its end is in view, then stays there (top below 0)
      const h = Math.min(a, b);
      if (h > window.innerHeight - 100) short.style.top = `${Math.round(window.innerHeight - h - 16)}px`;
    }
  };
  let t = 0;
  const later = () => { clearTimeout(t); t = window.setTimeout(check, 120); };
  const ro = new ResizeObserver(later);
  for (const row of rows) for (const c of row.children) ro.observe(c);
  window.addEventListener('resize', later);
  check();
}

export function startCore(): void {
  for (const [name, start] of [
    ['refresh', refreshButton], ['side menu', sideMenu], ['save reminder', saveReminder], ['confirmations', confirmations],
    ['helpers', smallHelpers], ['live parts', liveParts], ['instant saves', instantSaves], ['lists', lists], ['jobs', jobs], ['zoom', zoomPictures], ['sticky sides', stickySides],
  ] as [string, () => void][]) {
    try { start(); } catch (e) { console.error(`সবমিলবে admin: ${name} could not start`, e); }
  }
}

