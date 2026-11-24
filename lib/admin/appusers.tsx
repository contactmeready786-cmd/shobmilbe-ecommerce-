// Admin → Customers → 📱 App users (owner, 2026-11-24; lib/services/appdevices.ts).
// Every phone the customer Android app runs on, kept for good: when it was first and last opened, how often, the phone,
// app version, the approximate area its internet points to (IP — a city/division, never a home address), and — once
// an order is placed from it — the customer's name, mobile number and the delivery address they wrote on the order.
// Phones on app 1.5+ get personal notifications (parcel sent / delivered + review / review reminder / the owner's own
// message); the switches for those live here.
import type { AppDevicesRow } from '../data/rows';
import { Val, attrValue, jsxList } from '../react/html';
import { int, str, fmtDate, bn } from '../util';
import * as ui from './ui';
import * as db from '../db';
import * as A from '../services/appdevices';
import { flag, place } from '../services/visitors';
import type { AdminCtx } from '../types';

const BASE = '/admin/app-users';
const PER = 50;

function when(d: Date | null | undefined) { return d ? fmtDate(d, true) : '—'; }
function lastActive(r: AppDevicesRow) {
  const a = r.last_seen ? new Date(r.last_seen).getTime() : 0;
  const b = r.last_poll ? new Date(r.last_poll).getTime() : 0;
  return new Date(Math.max(a, b));
}
function ago(d: Date) {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

async function page(ctx: AdminCtx) {
  const s = ctx.settings;
  if (ctx.method === 'POST') {
    const b = await ctx.body<'action' | 'id' | 'title' | 'body' | 'url' | 'app_notify_on' | 'app_review_ask'>();
    if (b.action === 'pill_notify' || b.action === 'pill_review') {
      if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
      const key = b.action === 'pill_notify' ? 'app_notify_on' : 'app_review_ask';
      const on = !!b[key as 'app_notify_on' | 'app_review_ask'];
      await db.setMany({ [key]: on ? '1' : '0' });
      await ctx.log('update', 'settings', null, `${key === 'app_notify_on' ? 'App order notifications' : 'App review requests'}: ${on ? 'on' : 'off'}`);
      return ctx.back(BASE, 'saved');
    }
    if (b.action === 'send') {
      if (!ctx.can('marketing')) return ctx.back(BASE, 'noperm');
      const id = str(b.id, 80);
      const title = str(b.title, 60);
      if (!title) return ctx.fail(`${BASE}?d=${encodeURIComponent(id)}`, 'Write a title.');
      let url = str(b.url, 300);
      if (url && !/^\/(?!\/)/.test(url)) url = '/' + url.replace(/^\/+|^https?:\/\/[^/]+\/?/i, '');
      const ok = await A.sendOne(id, { title, body: str(b.body, 200), url }, ctx.user.id);
      await ctx.log('app_notice', 'app_device', null, `App message "${title}" → ${id}`);
      return ok ? ctx.back(`${BASE}?d=${encodeURIComponent(id)}`, 'app_sent') : ctx.fail(`${BASE}?d=${encodeURIComponent(id)}`, 'This phone has an older app (1.4) — it can get messages after the app is updated.');
    }
    return ctx.back(BASE);
  }

  const q = str(ctx.query.get('q'), 60);
  const only = str(ctx.query.get('only'), 20);
  const pg = Math.max(1, int(ctx.query.get('page')) || 1);
  const sel = str(ctx.query.get('d'), 80);
  const [k, list, picked] = await Promise.all([A.stats(), A.list({ q, only }, PER, (pg - 1) * PER),
    sel ? db.one<AppDevicesRow>('SELECT * FROM app_devices WHERE id=$1', [sel]) : null]);
  const sent = picked ? await A.notices(picked.id) : [];
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(only ? { only } : {}) });
  const chips: [string, string, number][] = [['', '📱 All phones', k.total], ['active', '🟢 Active (7 days)', k.active7], ['customers', '🧾 Ordered from app', k.customers], ['notify', '🔔 Can get notifications', k.notify]];

  const fact = (label: string, v: unknown) => <div style={{ minWidth: '150px' }}><span className="small muted">{label}</span><div style={{ fontWeight: 600 }}>{v as never}</div></div>;
  const detail = picked ? <section className="panel" id="device" style={{ padding: '12px 16px' }}>
    <div className="title-row" style={{ marginBottom: '8px' }}><h2 style={{ fontSize: '1rem' }}>📱 <Val v={[picked.brand, picked.model].filter(Boolean).join(' ') || 'Phone'} /> <span className="small muted">· app v<Val v={picked.app_version || '?'} /></span></h2><a className="btn btn-ghost btn-sm" href={`${BASE}?${qs}`}>✕ Close</a></div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 28px' }} translate="no">
      {fact('Customer', picked.phone ? <><Val v={picked.name || '—'} /> · <a href={`tel:${attrValue(picked.phone)}`}><Val v={picked.phone} /></a> · <a href={`https://wa.me/88${attrValue(picked.phone)}`} target="_blank" rel="noopener">WhatsApp</a> · <a href={`/admin/orders?q=${attrValue(picked.phone)}`}>Orders ({picked.orders})</a></> : <span className="muted">Not known yet</span>)}
      {(picked.address ? fact('Delivery address', <><Val v={picked.address} />{(picked.area ? <span className="muted">, <Val v={picked.area} /></span> : null)}</>) : null)}
      {fact('Area (from IP)', <>{flag(picked.country)} <Val v={place(picked).text || '—'} /> <span className="muted mono small">· <Val v={picked.ip || '—'} /></span></>)}
      {fact('First opened', when(picked.first_seen))}
      {fact('Last active', <>{when(lastActive(picked))} <span className="muted">· {bn(picked.opens)} opens</span></>)}
      {fact('Notifications', picked.can_notify ? '🔔 Can receive' : <span className="muted">Older app — after update</span>)}
    </div>
    {(picked.can_notify ? <form method="post" action={attrValue(BASE)} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
      <input type="hidden" name="action" defaultValue="send" /><input type="hidden" name="id" defaultValue={attrValue(picked.id)} />
      <input name="title" maxLength={60} required placeholder="Notification title" style={{ flex: '1 1 180px' }} />
      <input name="body" maxLength={200} placeholder="Message (optional)" style={{ flex: '2 1 240px' }} />
      <input name="url" maxLength={300} placeholder="Opens page, e.g. /p/name (optional)" style={{ flex: '1 1 180px' }} />
      <button className="btn btn-sm">✉️ Send</button>
    </form> : null)}
    {(sent.length ? <table className="table compact" style={{ marginTop: '10px' }}><thead><tr><th>Sent</th><th>Notification</th><th>Shown on phone</th></tr></thead><tbody>
      {jsxList(sent.map((n) => <tr><td className="small" style={{ whiteSpace: 'nowrap' }}>{when(n.created_at)}</td><td><b><Val v={n.title} /></b> <span className="small muted"><Val v={n.body} /></span></td><td className="small" style={{ whiteSpace: 'nowrap' }}>{(n.delivered_at ? '✅ ' + when(n.delivered_at) : '⏳ waiting')}</td></tr>))}
    </tbody></table> : null)}
  </section> : null;

  const nowrap = { whiteSpace: 'nowrap' } as const;
  const canSet = ctx.can('settings');
  const body = <>
    <div className="title-row"><h1>📱 App users</h1>
      <div className="row-actions">
        {(canSet ? ui.toolSwitch(BASE, 'app_notify_on', s.app_notify_on !== '0', '🔔 Order notifications', 'Parcel sent / delivered — sent to the phone the order came from (app 1.5+). Free, no SMS.', { action: 'pill_notify' }) : null)}
        {(canSet ? ui.toolSwitch(BASE, 'app_review_ask', s.app_review_ask !== '0', '⭐ Ask for review', 'On delivery a "please review" notification with the one-tap link; one reminder after 3 days if there is no review.', { action: 'pill_review' }) : null)}
        <a className="btn btn-ghost btn-sm" href={`${BASE}?${qs}`}>🔄 Refresh</a>
      </div></div>
    {ui.flash(ctx.flash)}
    <div className="toolbar">
      <div className="chips status-chips stat-chips" style={{ margin: 0 }}>
        {jsxList(chips.map(([key, label, n]) => <a className={`chip ${key === 'active' ? 'chip-active' : ''} ${only === key ? 'on' : ''}`} href={`${BASE}?${new URLSearchParams({ ...(key ? { only: key } : {}), ...(q ? { q } : {}) })}`}>{label} <b>{bn(n)}</b></a>))}
        <span className="chip" title="Phones that opened the app for the first time in the last 7 days">🆕 New this week <b>{bn(k.new7)}</b></span>
        <span className="chip" title="Orders placed from the app">🛒 App orders <b>{bn(k.orders)}</b></span>
      </div>
      <form method="get" action={attrValue(BASE)} style={{ display: 'flex', gap: '8px', flex: '1 1 260px', justifyContent: 'flex-end' }}>
        {(only ? <input type="hidden" name="only" defaultValue={attrValue(only)} /> : null)}
        <input type="search" name="q" defaultValue={attrValue(q)} placeholder="Name, mobile, phone, area or IP" aria-label="Search" />
        <button className="btn btn-sm">Search</button>
      </form>
    </div>
    {detail}
    <section className="panel table-wrap">
      {(list.rows.length ? <><table className="table compact"><thead><tr><th>Customer</th><th>Phone</th><th>Area (IP)</th><th className="num">Opens</th><th className="num">Orders</th><th>Last active</th><th>First opened</th><th title="Can get notifications (app 1.5+)">🔔</th><th></th></tr></thead><tbody>
        {jsxList(list.rows.map((r) => <tr>
          <td translate="no" style={nowrap}>{(r.phone ? <><b><Val v={r.name || '—'} /></b> <span className="small mono muted"><Val v={r.phone} /></span></> : <span className="muted small">Not ordered yet</span>)}</td>
          <td className="small" style={nowrap}><Val v={[r.brand, r.model].filter(Boolean).join(' ') || '—'} /> <span className="muted">· v<Val v={r.app_version || '?'} /></span></td>
          <td className="small" style={nowrap}>{flag(r.country)} <Val v={place(r).text || '—'} /></td>
          <td className="num">{bn(r.opens)}</td>
          <td className="num">{bn(r.orders)}</td>
          <td className="small" style={nowrap} title={attrValue(when(lastActive(r)))}>{ago(lastActive(r))}</td>
          <td className="small muted" style={nowrap}>{fmtDate(r.first_seen, false)}</td>
          <td>{(r.can_notify ? '🔔' : <span className="muted">—</span>)}</td>
          <td style={nowrap}><a className="btn btn-sm btn-ghost" href={`${BASE}?${new URLSearchParams({ ...Object.fromEntries(qs), d: r.id })}#device`}>Details</a></td>
        </tr>))}
      </tbody></table>{ui.pager(list.total, pg, PER, `${BASE}?${qs}`)}</> : <p className="muted" style={{ padding: '14px 16px', margin: 0 }}>{(q || only ? 'No phone matches.' : 'No app phones yet. A phone shows here the first time the app is opened on it.')}</p>)}
    </section>
  </>;
  return ctx.page('App users', body, 'appusers');
}

export const routes = [
  { method: 'GET', path: BASE, perm: 'customers', handler: page },
  { method: 'POST', path: BASE, perm: 'customers', handler: page },
];
