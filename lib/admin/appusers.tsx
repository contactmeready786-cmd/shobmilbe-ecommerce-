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
    if (b.action === 'settings') {
      if (!ctx.can('settings')) return ctx.back(BASE, 'noperm');
      await db.setMany({ app_notify_on: b.app_notify_on ? '1' : '0', app_review_ask: b.app_review_ask ? '1' : '0' });
      await ctx.log('update', 'settings', null, `App notifications: ${b.app_notify_on ? 'on' : 'off'}, review requests: ${b.app_review_ask ? 'on' : 'off'}`);
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
  const chips: [string, string, number][] = [['', 'All phones', k.total], ['active', '🟢 Active this week', k.active7], ['customers', '🧾 Ordered from the app', k.customers], ['notify', '🔔 Can get notifications', k.notify]];

  const detail = picked ? <section className="panel" id="device">
    <div className="title-row"><h2>📱 <Val v={[picked.brand, picked.model].filter(Boolean).join(' ') || 'Phone'} /></h2><a className="btn btn-ghost btn-sm" href={`${BASE}?${qs}`}>✕ Close</a></div>
    <table className="table compact"><tbody>
      <tr><th>Customer</th><td translate="no">{(picked.phone ? <><b><Val v={picked.name || '—'} /></b> · <a href={`tel:${attrValue(picked.phone)}`}><Val v={picked.phone} /></a> · <a href={`https://wa.me/88${attrValue(picked.phone)}`} target="_blank" rel="noopener">WhatsApp</a> · <a href={`/admin/orders?q=${attrValue(picked.phone)}`}>Orders ({picked.orders})</a></> : <span className="muted">Not known yet — shown after an order is placed from this phone</span>)}</td></tr>
      {(picked.address ? <tr><th>Delivery address</th><td translate="no"><Val v={picked.address} />{(picked.area ? <><br /><span className="muted"><Val v={picked.area} /></span></> : null)}</td></tr> : null)}
      <tr><th>Area (from IP)</th><td>{flag(picked.country)} <Val v={place(picked) || '—'} /> <span className="muted mono small">· IP <Val v={picked.ip || '—'} /></span></td></tr>
      <tr><th>Phone</th><td><Val v={[picked.brand, picked.model, picked.os].filter(Boolean).join(' · ') || '—'} /> · app <Val v={picked.app_version || '—'} /></td></tr>
      <tr><th>First opened</th><td>{when(picked.first_seen)}</td></tr>
      <tr><th>Last active</th><td>{when(lastActive(picked))} · opened {bn(picked.opens)} times</td></tr>
      <tr><th>Notifications</th><td>{(picked.can_notify ? ui.pill('🔔 Can receive', 'pill-green') : ui.pill('Older app (1.4) — after update', ''))}</td></tr>
    </tbody></table>
    {(picked.can_notify ? <form method="post" action={attrValue(BASE)} className="form">
      <input type="hidden" name="action" defaultValue="send" /><input type="hidden" name="id" defaultValue={attrValue(picked.id)} />
      <h3>✉️ Send a notification to this phone</h3>
      {ui.input('title', '', { maxlength: 60, placeholder: 'Title (e.g. A special offer for you!)', required: true })}
      {ui.textarea('body', '', { rows: 2, maxlength: 200, placeholder: 'Message (optional)' })}
      {ui.input('url', '', { maxlength: 300, placeholder: 'Opens this shop page (optional, e.g. /p/product-name)' })}
      <button className="btn btn-sm">Send</button>
    </form> : null)}
    {(sent.length ? <><h3>Sent to this phone</h3><table className="table compact"><thead><tr><th>When</th><th>Message</th><th>Shown on phone</th></tr></thead><tbody>
      {jsxList(sent.map((n) => <tr><td className="small">{when(n.created_at)}</td><td><b><Val v={n.title} /></b><br /><span className="small muted"><Val v={n.body} /></span></td><td className="small">{(n.delivered_at ? '✅ ' + when(n.delivered_at) : '⏳ waiting')}</td></tr>))}
    </tbody></table></> : null)}
  </section> : null;

  const body = <>
    <div className="title-row"><h1>📱 App users <small>{bn(k.total)} phones</small></h1>
      <div className="row-actions"><a className="btn btn-ghost btn-sm" href={`${BASE}?${qs}`}>🔄 Refresh</a></div></div>
    {ui.flash(ctx.flash)}
    <div className="kpis kpis-tight">
      {ui.kpi('Phones with the app', bn(k.total), `${bn(k.new7)} new this week`, 'kpi-blue')}
      {ui.kpi('Active (7 days)', bn(k.active7), `${bn(k.active30)} in 30 days`)}
      {ui.kpi('Ordered from the app', bn(k.customers), `${bn(k.orders)} orders`, 'kpi-green')}
      {ui.kpi('Can get notifications', bn(k.notify), 'app 1.5 or newer')}
    </div>
    <div className="vc-bar">
      <div className="chips">{jsxList(chips.map(([key, label, n]) => <a className={`chip ${only === key ? 'on' : ''}`} href={`${BASE}?${new URLSearchParams({ ...(key ? { only: key } : {}), ...(q ? { q } : {}) })}`}>{label} <b>{bn(n)}</b></a>))}</div>
      <form className="toolbar" method="get" action={attrValue(BASE)}>
        {(only ? <input type="hidden" name="only" defaultValue={attrValue(only)} /> : null)}
        <input type="search" name="q" defaultValue={attrValue(q)} placeholder="Name, mobile, phone model, area or IP" aria-label="Search" />
        <button className="btn btn-sm">Search</button>
      </form>
    </div>
    {detail}
    <div className="two-col wide-left">
      <section className="panel">
        {(list.rows.length ? <><table className="table compact"><thead><tr><th>Customer</th><th>Phone</th><th>Area (IP)</th><th className="num">Opens</th><th className="num">Orders</th><th>Last active</th><th>🔔</th><th></th></tr></thead><tbody>
          {jsxList(list.rows.map((r) => <tr>
            <td translate="no">{(r.phone ? <><b><Val v={r.name || '—'} /></b><br /><span className="small mono"><Val v={r.phone} /></span></> : <span className="muted small">Not ordered yet</span>)}</td>
            <td className="small"><Val v={[r.brand, r.model].filter(Boolean).join(' ') || '—'} /><br /><span className="muted">app <Val v={r.app_version || '—'} /></span></td>
            <td className="small">{flag(r.country)} <Val v={place(r) || '—'} /></td>
            <td className="num">{bn(r.opens)}</td>
            <td className="num">{bn(r.orders)}</td>
            <td className="small" title={attrValue(when(lastActive(r)))}>{ago(lastActive(r))}<br /><span className="muted">since {fmtDate(r.first_seen)}</span></td>
            <td>{(r.can_notify ? '🔔' : '—')}</td>
            <td><a className="btn btn-sm btn-ghost" href={`${BASE}?${new URLSearchParams({ ...Object.fromEntries(qs), d: r.id })}#device`}>Details</a></td>
          </tr>))}
        </tbody></table>{ui.pager(list.total, pg, PER, `${BASE}?${qs}`)}</> : <p className="muted">{(q || only ? 'No phone matches.' : 'No app phones yet. A phone shows here the first time the app is opened on it.')}</p>)}
      </section>
      <div>
        <section className="set-sec"><div className="set-head"><h2 className="set-title">⚙️ App notifications</h2></div>
          <div className="panel set-card"><form method="post" action={attrValue(BASE)} className="form">
            <input type="hidden" name="action" defaultValue="settings" />
            {ui.switchRow('app_notify_on', s.app_notify_on !== '0', 'Order notifications in the app', 'When an order goes to the courier or is delivered, the phone it was ordered from (and app phones with the same mobile number) gets a notification. Free — no SMS.')}
            {ui.switchRow('app_review_ask', s.app_review_ask !== '0', 'Ask for a review', 'On delivery: a "How did you like it? Please review" message (in Bangla) with the one-tap review link; 3 days later one reminder if there is still no review.')}
            <button className="btn">Save</button>
          </form></div>
        </section>
      </div>
    </div>
  </>;
  return ctx.page('App users', body, 'appusers');
}

export const routes = [
  { method: 'GET', path: BASE, perm: 'customers', handler: page },
  { method: 'POST', path: BASE, perm: 'customers', handler: page },
];
