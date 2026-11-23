// Admin → Customers → 🎤 Voice & calls (owner, 2026-11-23; lib/models/voice.ts, client/admin/voice.tsx).
// Customers' voice messages from the shop's help button and the shop phone's call recordings, in one list: play,
// see who it is (their orders), note what was done, mark heard / done. Call recordings come from the phone:
// Google Phone app → Recents → the call → the recording → Share → "সবমিলবে Admin" (the installed admin app),
// or picked here as a file. Deleting goes to the recycle bin; recordings older than the owner's days go by themselves.
import { Val, attrValue, jsxList } from '../react/html';
import { int, fmtDate, bn } from '../util';
import * as ui from './ui';
import * as db from '../db';
import * as V from '../models/voice';
import type { AdminCtx, RouteMatch } from '../types';

const BASE = '/admin/voice';
const KEEP = [['30', '30 days'], ['60', '60 days'], ['90', '90 days'], ['180', '6 months'], ['365', '1 year']];
const PILL: Record<string, string> = { new: 'pill-red', heard: 'pill-amber', done: 'pill-green' };

const dur = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');
const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

async function page(ctx: AdminCtx) {
  if (ctx.method === 'POST') {
    const b = await ctx.body<'action' | 'id' | 'note' | 'phone' | 'name' | 'status' | 'voice_on' | 'voice_keep_days'>();
    const id = int(b.id);
    const back = String(ctx.query.get('back') || BASE);
    const to = /^\/admin\/voice(\?[\w=&%-]*)?$/.test(back) ? back : BASE;
    if (b.action === 'settings') {
      if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
      await db.setMany({ voice_on: b.voice_on === '1' ? '1' : '0', voice_keep_days: KEEP.some(([k]) => k === b.voice_keep_days) ? String(b.voice_keep_days) : '90' });
      await ctx.log('update', 'settings', null, 'Voice & calls settings');
      return ctx.back(BASE, 'saved');
    }
    if (!ctx.can('orders_edit')) return ctx.back(to, 'noperm');
    if (b.action === 'heard') { await V.markHeard(id, ctx.user.id); return ctx.json(200, { ok: true }); }
    if (b.action === 'status') { await V.setStatus(id, String(b.status), ctx.user.id); return ctx.back(`${to}#v-${id}`); }
    if (b.action === 'note') { await V.saveNote(id, { note: b.note, phone: b.phone, name: b.name }); return ctx.back(`${to}#v-${id}`, 'saved'); }
    if (b.action === 'delete') {
      await ctx.trash('voice', id);
      await ctx.log('delete', 'voice', id, 'Voice / call recording to the recycle bin');
      return ctx.back(to, 'deleted');
    }
    return ctx.back(to);
  }

  const kind = ctx.query.get('kind') || '';
  const status = ctx.query.get('status') || '';
  const q = String(ctx.query.get('q') || '').slice(0, 60);
  const [rows, c] = await Promise.all([V.list({ kind, status, q, limit: 60 }), V.counts()]);
  const s = ctx.settings;
  const here = `${BASE}?${new URLSearchParams({ ...(kind ? { kind } : {}), ...(status ? { status } : {}), ...(q ? { q } : {}) })}`;
  const tabs: [string, string, string, number][] = [['', '', 'All', c.all], ['', 'new', '🔴 New', c.new], ['message', '', '🎤 Voice messages', c.message], ['call', '', '📞 Call recordings', c.call]];
  const canEdit = ctx.can('orders_edit');

  const body = <>
    <div className="title-row"><h1>🎤 Voice &amp; calls <small>{bn(c.all)} recordings</small></h1>
      <div className="row-actions"><a className="btn btn-ghost btn-sm" href={attrValue(here)}>🔄 Refresh</a></div></div>
    {ui.flash(ctx.flash)}
    <div className="vc-bar">
      <div className="chips">{jsxList(tabs.map(([k, st, label, n]) => <a className={`chip ${kind === k && status === st ? 'on' : ''}`} href={`${BASE}?${new URLSearchParams({ ...(k ? { kind: k } : {}), ...(st ? { status: st } : {}) })}`}>{label} <b>{bn(n)}</b></a>))}</div>
      <form className="toolbar" method="get" action={attrValue(BASE)}>
        {(kind ? <input type="hidden" name="kind" defaultValue={attrValue(kind)} /> : null)}
        <input type="search" name="q" defaultValue={attrValue(q)} placeholder="Mobile, name, note or order no." aria-label="Search" />
        <button className="btn btn-sm">Search</button>
      </form>
    </div>

    <div className="vc-grid">
      <section className="panel vc-list" aria-label="Recordings">
        {(rows.length ? jsxList(rows.map((v) => <article className={`vc-item ${v.status === 'new' ? 'is-new' : ''}`} id={`v-${v.id}`}>
          <div className="vc-top">
            <span className={`vc-kind ${v.kind}`} title={v.kind === 'call' ? 'Call recording' : 'Voice message from the shop'}>{(v.kind === 'call' ? (v.direction === 'out' ? '📤' : v.direction === 'in' ? '📥' : '📞') : '🎤')}</span>
            <div className="vc-who" translate="no">
              <b><Val v={v.name || v.customer_name || (v.phone ? 'Customer' : 'Unknown number')} /></b>
              {(v.phone ? <span className="vc-links"><a className="mono" href={`tel:${attrValue(v.phone)}`}>📞 <Val v={v.phone} /></a>
                <a href={`https://wa.me/88${attrValue(v.phone)}`} target="_blank" rel="noopener">WhatsApp</a>
                <a href={`/admin/orders?q=${attrValue(v.phone)}`}>🧾 Orders ({bn(v.orders || 0)})</a>
                {(v.customer_id ? <a href={`/admin/customers/${attrValue(v.customer_id)}`}>👤 Customer</a> : null)}</span> : null)}
            </div>
            <div className="vc-meta">
              {ui.pill(V.STATUS[v.status]?.join(' ') || v.status, PILL[v.status] || '')}
              <span className="small muted">{fmtDate(v.call_at || v.created_at)}</span>
            </div>
          </div>
          <div className="vc-play">
            <audio controls preload="none" src={`${BASE}/audio/${attrValue(v.id)}`} data-voice-play={(v.status === 'new' && canEdit) ? String(v.id) : undefined}></audio>
            <span className="small muted">{dur(v.seconds)}{(v.seconds ? ' · ' : '')}{size(v.bytes)}</span>
          </div>
          <p className="small muted vc-from">
            {(v.kind === 'message' ? <>From the shop{(v.page ? <> · page <code><Val v={v.page} /></code></> : null)}</> : <>{(v.direction === 'out' ? 'Outgoing call' : v.direction === 'in' ? 'Incoming call' : 'Call')}{(v.staff_name ? <> · added by <Val v={v.staff_name} /></> : null)}</>)}
            {(v.order_code ? <> · order <a href={`/admin/orders?q=${attrValue(v.order_code)}`}><Val v={v.order_code} /></a></> : null)}
            {(v.handler_name && v.status !== 'new' ? <> · {(v.status === 'done' ? 'done' : 'heard')} by <Val v={v.handler_name} /></> : null)}
          </p>
          {(canEdit ? <form method="post" action={`${BASE}?back=${encodeURIComponent(here)}`} className="vc-note">
            <input type="hidden" name="action" defaultValue="note" />
            <input type="hidden" name="id" defaultValue={attrValue(v.id)} />
            <input name="phone" defaultValue={attrValue(v.phone)} placeholder="Mobile" maxLength={15} aria-label="Mobile" className="vc-phone" />
            <input name="name" defaultValue={attrValue(v.name)} placeholder="Name" maxLength={60} aria-label="Name" className="vc-name" />
            <input name="note" defaultValue={attrValue(v.note)} placeholder="Note — what they said / what was done" maxLength={500} aria-label="Note" className="vc-text" />
            <button className="btn btn-sm btn-ghost">Save</button>
          </form> : (v.note ? <p className="small"><Val v={v.note} /></p> : null))}
          {(canEdit ? <div className="vc-actions">
            {jsxList(Object.keys(V.STATUS).filter((k) => k !== v.status).map((k) => <form method="post" action={`${BASE}?back=${encodeURIComponent(here)}`}><input type="hidden" name="action" defaultValue="status" /><input type="hidden" name="id" defaultValue={attrValue(v.id)} /><input type="hidden" name="status" defaultValue={k} /><button className="btn btn-sm btn-ghost">{V.STATUS[k][0]} Mark {V.STATUS[k][1].toLowerCase()}</button></form>))}
            <form method="post" action={`${BASE}?back=${encodeURIComponent(here)}`} data-confirm="Move this recording to the recycle bin?"><input type="hidden" name="action" defaultValue="delete" /><input type="hidden" name="id" defaultValue={attrValue(v.id)} /><button className="btn btn-sm btn-ghost vc-del">🗑️ Delete</button></form>
          </div> : null)}
        </article>)) : <p className="muted vc-empty">{(q || kind || status ? 'Nothing matches.' : 'No recordings yet. Customers send voice messages from the shop’s help button; call recordings are added on the right.')}</p>)}
      </section>

      <aside className="vc-side">
        {(canEdit ? <section className="panel" id="add-call">
          <h2>📞 Add a call recording</h2>
          <form className="form" data-call-upload="">
            <div className="vc-file" data-call-file-box="">
              <input type="file" accept="audio/*,.m4a,.amr,.wav,.mp3,.ogg,.opus,.webm,.aac" data-call-file="" aria-label="Recording file" />
              <span className="small muted" data-call-file-name="">Pick the recording (or share it here from the phone)</span>
            </div>
            {ui.field('Customer mobile', ui.input('phone', '', { type: 'tel', maxlength: 15, placeholder: '01XXXXXXXXX' }))}
            {ui.field('Call', ui.select('direction', [['in', '📥 Customer called the shop'], ['out', '📤 Shop called the customer']], 'in'))}
            {ui.field('When', <input type="datetime-local" name="call_at" aria-label="When the call was (Bangladesh time)" />, 'Leave empty for now.')}
            {ui.field('Note', ui.input('note', '', { maxlength: 500, placeholder: 'What the call was about' }))}
            <p className="vc-up-msg small" data-call-msg="" aria-live="polite"></p>
            <button className="btn" data-call-send="">⬆️ Upload</button>
          </form>
          <p className="small muted vc-howto">On the Motorola: <b>Phone</b> → <b>Recents</b> → the call → recording → <b>Share</b> → <b>সবমিলবে Admin</b>. It opens here with the file ready.</p>
        </section> : null)}
        {(ctx.can('settings') ? <section className="panel">
          <h2>⚙️ Settings</h2>
          <form method="post" action={attrValue(BASE)} className="form">
            <input type="hidden" name="action" defaultValue="settings" />
            {ui.switchRow('voice_on', s.voice_on !== '0', 'Voice messages on the shop', 'A “🎤 ভয়েস মেসেজ পাঠান” button in the help box.')}
            {ui.field('Keep recordings for', ui.select('voice_keep_days', KEEP, KEEP.some(([k]) => k === s.voice_keep_days) ? s.voice_keep_days : '90'), 'Older ones are removed for good by themselves.')}
            <button className="btn">Save</button>
          </form>
        </section> : null)}
      </aside>
    </div>
  </>;
  return ctx.page('Voice & calls', body, 'voice');
}

// the sound itself — only for logged-in staff, never cached on a shared machine
async function audio(ctx: AdminCtx, m: RouteMatch) {
  const a = await V.audio(int(m[1]));
  if (!a) return ctx.send(404, 'Not found', 'text/plain');
  return ctx.reply.answer(200, { 'Content-Type': /^audio\/[\w.+-]+$/.test(a.mime) ? a.mime : 'application/octet-stream', 'Cache-Control': 'private, max-age=600',
    'Content-Length': String(a.audio.length), 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }, a.audio);
}

// a call recording from the page's upload box (the file read in the browser, sent as JSON)
async function upload(ctx: AdminCtx) {
  const b = await ctx.body<'audio' | 'phone' | 'direction' | 'note' | 'call_at' | 'name'>();
  const at = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(b.call_at || '')) ? new Date(`${b.call_at}:00+06:00`) : null;
  try {
    const id = await V.addCall({ data: b.audio, phone: b.phone, direction: b.direction, note: b.note, callAt: at, staffId: ctx.user.id, name: b.name });
    await ctx.log('create', 'voice', id, 'Call recording added');
    return ctx.json(200, { ok: true, id, url: `${BASE}?kind=call#v-${id}` });
  } catch (e) {
    if (e instanceof V.VoiceError) return ctx.json(400, { error: e.message });
    throw e;
  }
}

// "Share → সবমিলবে Admin" that reached the server instead of the admin's service worker (the app not opened yet
// on this phone): the file can't be kept from here, so say what to do
async function shareFallback(ctx: AdminCtx) {
  return ctx.back(`${BASE}?err=${encodeURIComponent('The recording did not arrive. Open this Voice & calls page once in the admin app, then share it again.')}#add-call`);
}

export const routes = [
  { method: '*', path: BASE, perm: 'orders', handler: page },
  { method: 'GET', path: /^\/admin\/voice\/audio\/(\d+)$/, perm: 'orders', handler: audio },
  { method: 'POST', path: '/admin/voice/upload', perm: 'orders_edit', handler: upload },
  { method: 'POST', path: '/admin/voice/share', perm: 'orders', handler: shareFallback },
];
