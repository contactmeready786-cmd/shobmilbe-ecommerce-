import { Val, attrValue, jsxList } from '../react/html';
import { bn, fmtDate, int, list } from '../util';
import * as S from '../models/staff';
import * as sessions from '../models/sessions';
import * as db from '../db';
import * as ui from './ui';
import * as P from './profile';
import * as $account from './account';
import type { AdminCtx, Loose, StaffUser, RouteMatch } from '../types';

async function listPage(ctx: AdminCtx) {
  const rows = await S.listStaff();
  const body = <><div className="title-row"><h1>স্টাফ ও প্রোফাইল{' '}<small>{bn(rows.length)}{' '}জন</small></h1><div className="row-actions"><a className="btn" href="/admin/staff/new">+ নতুন স্টাফ</a><a className="btn btn-ghost" href="/admin/reports/staff">স্টাফ রিপোর্ট</a></div></div>{ui.flash(ctx.flash)}{' '}{ui.helpBox('স্টাফ কীভাবে কাজ করে', <>প্রতিটা কর্মচারীকে আলাদা ইউজারনেম-পাসওয়ার্ড দিন, আর শুধু দরকারি কাজের অনুমতি টিক দিন। পণ্য, স্টক আর কাস্টমারে আলাদা আলাদা টিক আছে:{' '}<b>দেখা</b>,{' '}<b>যোগ</b>,{' '}<b>এডিট</b>,{' '}<b>মুছা</b>। যেমন যে শুধু কল করে অর্ডার কনফার্ম করে, তাকে "অর্ডার দেখা" আর "অর্ডার এডিট" দিলেই হবে — সে লাভ-ক্ষতি, কেনা দাম বা সেটিংস দেখতে পারবে না। কাউকে বাদ দিতে চাইলে মুছে না দিয়ে "লগইন চালু" বন্ধ করুন — তার আগের সব কাজের রেকর্ড থেকে যাবে। কে কখন কী করেছে সব{' '}<a href="/admin/security/audit">অডিট লগে</a>{' '}থাকে।</>)}<section className="panel table-wrap"><table className="table"><thead><tr><th>নাম</th><th>ইউজারনেম</th><th>অনুমতি</th><th>দুই ধাপ</th><th>শেষ লগইন</th><th>লগইন চালু</th><th>কাজ</th></tr></thead><tbody>{jsxList(rows.map((s) => <tr className={s.active ? '' : 'row-off'}><td><a className="staff-who" href={`/admin/staff/${attrValue(s.id)}`}>{P.avatar(s)}<span><b><Val v={s.name} /></b>{(s.designation ? <><br /><span className="small"><Val v={s.designation} /></span></> : null)}{(s.phone ? <><br /><span className="small muted"><Val v={s.phone} /></span></> : null)}</span></a></td><td className="mono"><Val v={s.username} /></td><td className="small">{(s.role === 'owner' ? ui.pill('মালিক — সব অনুমতি', 'pill-delivered') : <Val v={(s.permissions || []).map((p?: Loose) => (S.PERMISSIONS.find((x) => x[0] === p) || [p, p])[1]).join(', ') || '—'} />)}</td><td className="small">{(s.role === 'owner' ? "—" : (s.totp_on ? "✅ চালু" : <span className="muted">বন্ধ</span>))}</td><td className="small">{(s.last_login ? fmtDate(s.last_login) : "কখনো না")}</td><td>{(s.role === 'owner' || s.id === ctx.user.id ? <span className="small">{(s.active ? "চালু" : "বন্ধ")}</span> : ui.rowSwitch(`/admin/toggle/staff/${s.id}`, s.active, 'বন্ধ করলে এই স্টাফ আর লগইন করতে পারবে না'))}</td>{ui.rowActions({ edit: `/admin/staff/${s.id}`, del: s.role === 'owner' || s.id === ctx.user.id ? '' : `/admin/staff/${s.id}/delete` })}</tr>))}</tbody></table></section></>;
  return ctx.page('স্টাফ', body, 'staff');
}

function form(s?: Loose, error?: Loose, isSelf?: Loose) {
  const isNew = !s.id;
  const owner = s.role === 'owner';
  const perms = s.permissions || [];
  return <><p className="crumbs"><a href="/admin/staff">← সব স্টাফ</a></p><h1>{(isNew ? "নতুন স্টাফ" : <Val v={s.name} />)}{(!isNew && s.designation ? <>{' '}<small><Val v={s.designation} /></small></> : null)}</h1>{(!isNew ? P.photoBox(s, `/admin/staff/${s.id}/photo`) : null)}{' '}{(error ? <p className="flash flash-error"><Val v={error} /></p> : null)}<form method="post" action={isNew ? '/admin/staff/new' : `/admin/staff/${s.id}`} className="form"><div className="two-col"><div className="stack"><section className="panel"><h2>লগইনের তথ্য</h2>{ui.field('নাম', ui.input('name', s.name || '', { required: true, maxlength: 80 }))}{' '}{ui.field('ইউজারনেম', ui.input('username', s.username || '', { required: true, maxlength: 40, autocapitalize: 'none', autocomplete: 'off' }), 'ইংরেজি ছোট হাতের অক্ষর/সংখ্যা, যেমন rahim')}<div className="field-row">{ui.field('মোবাইল (এটা দিয়েও লগইন করা যাবে)', ui.input('phone', s.phone || '', { inputmode: 'tel', maxlength: 20 }))}{ui.field('ইমেইল', ui.input('email', s.email || '', { type: 'email', maxlength: 120 }))}</div>{ui.field(isNew ? 'পাসওয়ার্ড' : 'নতুন পাসওয়ার্ড (বদলাতে চাইলে)', ui.input('password', '', { type: 'password', minlength: 8, required: isNew, autocomplete: 'new-password' }), 'কমপক্ষে ৮ অক্ষর, অক্ষর আর সংখ্যা মিলিয়ে (যেমন Rahim#2025)। স্টাফকে জানিয়ে দিন, আর প্রথম লগইনের পর নিজের পাসওয়ার্ড বানিয়ে নিতে বলুন।')}{' '}{ui.field('মালিকের নোট (শুধু মালিক দেখেন)', ui.textarea('note', s.note || '', { rows: 2, maxlength: 500, placeholder: 'যেমন: বেতন, কাজের সময়' }))}{' '}{(owner ? <p className="muted">এটা মালিকের অ্যাকাউন্ট, সবসময় চালু থাকে।</p> : ui.check('active', isNew ? true : s.active, 'অ্যাকাউন্ট চালু (বন্ধ করলে আর লগইন করতে পারবে না)'))}</section><section className="panel"><h2>👤 প্রোফাইল</h2>{(isNew ? <p className="small muted">প্রোফাইল ছবি স্টাফ যোগ করার পরে দেওয়া যাবে (এই পেজেই উপরে)।</p> : null)}{' '}{P.fields(s, { ownerEdit: true })}</section></div><section className="panel"><h2>কী কী করতে পারবে</h2>{(owner ? <p>মালিকের সব অনুমতি আছে।</p> : <><p className="small">দ্রুত বাছুন:{' '}{jsxList(Object.entries(S.PRESETS).map(([k, p]) => <><button type="button" className="chip" data-preset={p.perms.join(',')}><Val v={p.label} /></button>{' '}</>))}</p><div className="perm-list" data-perms="">{jsxList([...new Set(S.PERMISSIONS.map((p) => p[3]))].map((g) => <><p className="perm-group"><Val v={g} /></p>{jsxList(S.PERMISSIONS.filter((p) => p[3] === g).map(([k, label, hint]) => <label className="perm"><input type="checkbox" name="permissions[]" defaultValue={attrValue(k)} defaultChecked={!!(perms.includes(k))} />{' '}<span><b><Val v={label} /></b><small><Val v={hint} /></small></span></label>))}</>))}</div><p className="small muted">কেনা দাম, লাভ-ক্ষতি, স্টাফ, নিরাপত্তা, নোটিফিকেশন আর রিসাইকেল বিন সবসময় শুধু মালিকের — কোনো স্টাফকে দেওয়া যায় না।</p></>)}</section></div><div className="form-actions sticky-actions"><button className="btn btn-lg">{(isNew ? "স্টাফ যোগ করুন" : "সেভ করুন")}</button></div></form>{(!isNew && !owner && !isSelf ? <form method="post" action={`/admin/staff/${attrValue(s.id)}/delete`} className="danger-zone" data-confirm="এই স্টাফকে মুছবেন? (শুধু বন্ধ করতে চাইলে 'অ্যাকাউন্ট চালু' টিক তুলে দিন)"><button className="btn btn-danger btn-sm">স্টাফ মুছুন</button></form> : null)}</>;
}

async function formPage(ctx: AdminCtx, m: RouteMatch | null) {
  const id = m && m[1] ? int(m[1]) : null;
  if (ctx.method === 'POST') {
    const b = await ctx.body();
    try {
      const clash = await P.contactProblem(id, b.phone, b.email);
      if (clash) throw new Error(clash);
      const sid = await S.saveStaff({ ...b, id, permissions: list(b.permissions) });
      await S.saveProfile(sid, { designation: b.designation, address: b.address, emergency_phone: b.emergency_phone, joined_on: b.joined_on, bio: b.bio });
      await ctx.log(id ? 'staff_edit' : 'staff_add', 'staff', sid, b.name);
      return ctx.back(`/admin/staff/${sid}`, 'saved');
    } catch (e: Loose) {
      const cur = id ? await S.getStaff(id) : {};
      return ctx.page('স্টাফ', form({ ...cur, ...b, id, permissions: list(b.permissions) }, e.message, id === ctx.user.id), 'staff', { status: 400 });
    }
  }
  // (a new staff member: an empty form, switched on, no permissions yet)
  const s: Partial<StaffUser> | null = id ? await S.getStaff(id) : { active: true, permissions: [] };
  if (!s) return ctx.redirect('/admin/staff');
  const activity = id ? await S.activity({ staffId: id, limit: 40 }) : [];
  const devices = id ? await sessions.listFor(id, ctx.settings) : [];
  const logins = id ? await sessions.history({ staffId: id }, { limit: 10 }) : [];
  return ctx.page(id ? String(s.name) : 'নতুন স্টাফ', <>{ui.flash(ctx.flash)}{form(s, null, id === ctx.user.id)}{' '}{(id ? <section className="panel" id="security"><h2>🔐 লগইন ও নিরাপত্তা</h2>{(s.role === 'owner' ? <p className="small">মালিকের দুই ধাপের লগইন:{' '}<a href="/admin/security/login">লগইন তালা (আঙুলের ছাপ)</a></p> : <><p>দুই ধাপের লগইন (অথেনটিকেটর অ্যাপ):{' '}<b>{(s.totp_on ? "✅ চালু" : "বন্ধ")}</b>{(ctx.settings.staff_2fa_required === '1' ? <>{' '}<span className="small muted">(সবার জন্য বাধ্যতামূলক)</span></> : null)}</p>{(s.totp_on || s.totp_secret ? <form method="post" action={`/admin/staff/${attrValue(s.id)}/2fa-reset`} data-confirm={`${attrValue(s.name)}-এর দুই ধাপের লগইন রিসেট করবেন? (ফোন হারালে বা নতুন ফোন নিলে) পরের লগইনে আবার সেটআপ করতে হবে।`}><button className="btn btn-sm btn-ghost">দুই ধাপের লগইন রিসেট করুন</button></form> : null)}</>)}<div className="title-row"><h3>যেসব ডিভাইসে এখন লগইন আছে{' '}<small><Val v={ui.bn(devices.length)} />টি</small></h3>{(devices.length && s.id !== ctx.user.id ? <form method="post" action={`/admin/staff/${attrValue(s.id)}/logout-all`} data-confirm={`${attrValue(s.name)}-কে সব ডিভাইস থেকে লগআউট করবেন?`}><button className="btn btn-sm btn-danger">সব ডিভাইস থেকে লগআউট করান</button></form> : null)}</div>{$account.devicesTable(devices, ctx.user.__session, '/admin/security/sessions/logout')}<h3>সাম্প্রতিক লগইন</h3>{(logins.length ? <ul className="timeline">{jsxList(logins.map((h) => <li className={h.ok ? '' : 'warn'}><Val v={sessions.EVENTS[h.event] || h.event} />{(h.detail ? ` · ${h.detail}` : null)}{' '}·{' '}<Val v={h.device} /><br /><span className="small muted">{fmtDate(h.created_at)}{' '}·{' '}{(h.place ? (h.place + ' · ') : null)}<Val v={h.ip} /></span></li>))}</ul> : <p className="muted small">এখনো কিছু নেই।</p>)}<p className="small"><a href={`/admin/security/logins?staff=${attrValue(s.id)}`}>পুরো লগইন ইতিহাস →</a>{' '}·{' '}<a href={`/admin/security/audit?staff=${attrValue(s.id)}`}>এই স্টাফের সব কাজ (অডিট লগ) →</a></p></section> : null)}{' '}{(id ? <section className="panel"><h2>সাম্প্রতিক কাজ</h2>{(activity.length ? <ul className="timeline">{jsxList(activity.map((a) => <li><Val v={a.action} />{(a.entity ? <>{' '}·{' '}{(a.entity === 'order' && a.entity_id ? <a href={`/admin/orders/${attrValue(a.entity_id)}`}>অর্ডার #<Val v={a.entity_id} /></a> : <Val v={a.entity} />)}</> : null)}{(a.detail ? ` · ${a.detail}` : null)}<br /><span className="small muted">{fmtDate(a.created_at)}</span></li>))}</ul> : <p className="muted">কিছু নেই।</p>)}</section> : null)}</>, 'staff');
}

async function resetTwoFactor(ctx: AdminCtx, m: RouteMatch) {
  const id = int(m[1]);
  const s = await S.getStaff(id);
  if (!s || s.role === 'owner') return ctx.back('/admin/staff');
  await db.q(`UPDATE staff SET totp_on=false, totp_secret='', totp_last_step=0 WHERE id=$1`, [id]);
  await ctx.log('tfa_reset', 'staff', id, `${s.name}-এর দুই ধাপের লগইন রিসেট`);
  return ctx.redirect(`/admin/staff/${id}?info=${encodeURIComponent('দুই ধাপের লগইন রিসেট হয়েছে।' + (ctx.settings.staff_2fa_required === '1' ? ' পরের লগইনে আবার সেটআপ করতে হবে।' : ''))}#security`);
}
async function logoutAll(ctx: AdminCtx, m: RouteMatch) {
  const id = int(m[1]);
  const s = await S.getStaff(id);
  if (!s || id === ctx.user.id) return ctx.back('/admin/staff');
  const n = await sessions.revokeAll(id, `মালিক লগআউট করিয়েছেন (${ctx.user.name})`);
  await sessions.record(ctx.req, { staffId: id, login: s.username, event: 'revoked', ok: true, ip: ctx.ip, detail: `মালিক ${n}টি ডিভাইস থেকে লগআউট করিয়েছেন` });
  await ctx.log('staff_logout', 'staff', id, `${s.name}: ${n}টি ডিভাইস থেকে লগআউট`);
  return ctx.redirect(`/admin/staff/${id}?info=${encodeURIComponent(`${s.name} এখন সব ডিভাইস থেকে লগআউট।`)}#security`);
}

async function remove(ctx: AdminCtx, m: RouteMatch) {
  const id = int(m[1]);
  if (id === ctx.user.id) return ctx.fail('/admin/staff', 'নিজেকে মুছতে পারবেন না।');
  await ctx.trash('staff', id);
  await ctx.log('staff_delete', 'staff', id, '');
  return ctx.back('/admin/staff', 'deleted');
}

export const routes = [
    { method: 'GET', path: '/admin/staff', perm: 'owner', handler: listPage },
    { method: '*', path: '/admin/staff/new', perm: 'owner', handler: (ctx: AdminCtx) => formPage(ctx, null) },
    { method: '*', path: /^\/admin\/staff\/(\d+)$/, perm: 'owner', handler: formPage },
    { method: 'POST', path: /^\/admin\/staff\/(\d+)\/delete$/, perm: 'owner', handler: remove },
    { method: 'POST', path: /^\/admin\/staff\/(\d+)\/2fa-reset$/, perm: 'owner', handler: resetTwoFactor },
    { method: 'POST', path: /^\/admin\/staff\/(\d+)\/logout-all$/, perm: 'owner', handler: logoutAll },
  ];
