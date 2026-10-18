// ⚛️ Customer side: "আমার অ্যাকাউন্ট" (login with e-mail or mobile + a one-time code, my orders, addresses, profile,
// referral, gift cards), the return / refund request form, and the gift card page.
// Moved from lib/views/account.ts (2026-10-17); same HTML as before.
import type { ReactNode } from 'react';
import { money, bn, fmtDate } from '../../lib/util';
import * as O from '../../lib/models/orders';
import type { Loose, Settings } from '../../lib/types';

// ---------------------------------------------------------------- login
// Two tabs on top — 📧 ইমেইল / 📱 মোবাইল নম্বর. A tab is shown only when that way works (SMS / the shop's Gmail set up).
//  📧 e-mail: "লগইন" (e-mail + password, no code) · "নতুন অ্যাকাউন্ট" (e-mail + password → a code to the e-mail, once)
//            · "পাসওয়ার্ড ভুলে গেছেন?" (e-mail + new password → a code).
//  📱 mobile: number → SMS code → in (asked once; the phone stays logged in).
type LoginProps = { via?: string; step?: string; mode?: string; phone?: string; email?: string; error?: string; info?: string; next?: string; phoneOn?: boolean; emailOn?: boolean };

function PwFields({ label }: { label: string }) {
  return (
    <>
      <div className="field"><label htmlFor="apw">{label}</label><input id="apw" name="password" type="password" autoComplete="new-password" required minLength={6} maxLength={100} placeholder="কমপক্ষে ৬ অক্ষর" /></div>
      <div className="field"><label htmlFor="apw2">আবার একই পাসওয়ার্ড লিখুন</label><input id="apw2" name="password2" type="password" autoComplete="new-password" required minLength={6} maxLength={100} /></div>
    </>
  );
}
function EmailField({ email, auto }: { email: string; auto: boolean }) {
  return <div className="field"><label htmlFor="aemail">ইমেইল ঠিকানা</label><input id="aemail" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={120} placeholder="name@gmail.com" defaultValue={email} autoFocus={auto} /></div>;
}

function EmailForm({ step, m, email, next, em, nx }: { step: string; m: string; email: string; next: string; em: string; nx: string }) {
  if (step === 'code') {
    return (
      <>
        <form method="post" action="/account/email-verify" className="form">
          <input type="hidden" name="email" value={email} /><input type="hidden" name="mode" value={m} /><input type="hidden" name="next" value={next} />
          <p><b translate="no">{email}</b> ঠিকানায় একটা ৬ অঙ্কের কোড পাঠানো হয়েছে। ইমেইল খুলে কোডটা নিচে বসান। <span className="small muted">(Inbox-এ না পেলে Spam / Promotions ফোল্ডার দেখুন)</span></p>
          <div className="field"><label htmlFor="eotp">৬ অঙ্কের কোড</label><input id="eotp" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus className="otp-input" placeholder="••••••" /></div>
          <button className="btn btn-block btn-lg">{m === 'reset' ? 'যাচাই করে নতুন পাসওয়ার্ড সেভ করুন' : 'যাচাই করে অ্যাকাউন্ট খুলুন'}</button>
        </form>
        <p className="center small mt">কোড পাননি? ১ মিনিট অপেক্ষা করে Spam ফোল্ডার দেখুন, তারপর <a href={`/account?via=email&mode=${m}&email=${em}${nx}`}>আবার চেষ্টা করুন</a>।</p>
      </>
    );
  }
  if (m === 'signup') {
    return (
      <>
        <form method="post" action="/account/email-code" className="form">
          <input type="hidden" name="mode" value="signup" /><input type="hidden" name="next" value={next} />
          <EmailField email={email} auto />
          <PwFields label="একটা পাসওয়ার্ড ঠিক করুন" />
          <button className="btn btn-block btn-lg">ইমেইলে কোড পাঠান</button>
          <p className="small muted">ইমেইলটা আপনার কিনা যাচাই করতে <b>শুধু এই একবার</b> কোড যাবে। এরপর ইমেইল আর পাসওয়ার্ড দিয়েই ঢুকবেন।</p>
        </form>
        <p className="center small">আগেই অ্যাকাউন্ট আছে? <a href={`/account?via=email&email=${em}${nx}`}>লগইন করুন</a></p>
      </>
    );
  }
  if (m === 'reset') {
    return (
      <>
        <form method="post" action="/account/email-code" className="form">
          <input type="hidden" name="mode" value="reset" /><input type="hidden" name="next" value={next} />
          <p className="small">আপনার ইমেইল আর নতুন একটা পাসওয়ার্ড দিন। ইমেইলে একটা কোড যাবে, কোড মিললেই নতুন পাসওয়ার্ড চালু হবে।</p>
          <EmailField email={email} auto />
          <PwFields label="নতুন পাসওয়ার্ড" />
          <button className="btn btn-block btn-lg">ইমেইলে কোড পাঠান</button>
        </form>
        <p className="center small"><a href={`/account?via=email&email=${em}${nx}`}>← লগইনে ফিরে যান</a></p>
      </>
    );
  }
  return (
    <>
      <form method="post" action="/account/email-login" className="form">
        <input type="hidden" name="next" value={next} />
        <EmailField email={email} auto={!email} />
        <div className="field"><label htmlFor="alpw">পাসওয়ার্ড</label><input id="alpw" name="password" type="password" autoComplete="current-password" required maxLength={100} autoFocus={!!email} /></div>
        <button className="btn btn-block btn-lg">লগইন করুন</button>
      </form>
      <p className="center small"><a href={`/account?via=email&mode=reset&email=${em}${nx}`}>পাসওয়ার্ড ভুলে গেছেন?</a></p>
      <p className="center">নতুন কাস্টমার? <a className="btn btn-outline btn-sm" href={`/account?via=email&mode=signup&email=${em}${nx}`}>নতুন অ্যাকাউন্ট খুলুন</a></p>
    </>
  );
}

function PhoneForm({ step, phone, next, nx }: { step: string; phone: string; next: string; nx: string }) {
  if (step === 'code') {
    return (
      <>
        <form method="post" action="/account/verify" className="form">
          <input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} />
          <p><b translate="no">{phone}</b> নম্বরে SMS-এ কোড পাঠানো হয়েছে।</p>
          <div className="field"><label htmlFor="otp">৬ অঙ্কের কোড</label><input id="otp" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus className="otp-input" placeholder="••••••" /></div>
          <button className="btn btn-block btn-lg">যাচাই করে অ্যাকাউন্ট খুলুন</button>
        </form>
        <form method="post" action="/account/code" className="center mt"><input type="hidden" name="phone" value={phone} /><input type="hidden" name="next" value={next} /><button className="link-btn small">কোড পাননি? আবার পাঠান</button></form>
        <p className="center small"><a href={`/account?via=phone${nx}`}>← অন্য নম্বর দিন</a></p>
      </>
    );
  }
  return (
    <form method="post" action="/account/code" className="form">
      <input type="hidden" name="next" value={next} />
      <div className="field"><label htmlFor="aphone">মোবাইল নম্বর</label><input id="aphone" name="phone" inputMode="tel" autoComplete="tel" required maxLength={20} placeholder="01XXXXXXXXX" defaultValue={phone} autoFocus /></div>
      <button className="btn btn-block btn-lg">কোড পাঠান</button>
    </form>
  );
}

export function LoginPage({ via = '', step = 'start', mode = 'login', phone = '', email = '', error = '', info = '', next = '', phoneOn = true, emailOn = false }: LoginProps) {
  const tabs = ([emailOn && ['email', '📧 ইমেইল'], phoneOn && ['phone', '📱 মোবাইল নম্বর']].filter(Boolean)) as [string, string][];
  const cur = tabs.some((t) => t[0] === via) ? via : (tabs[0] || [''])[0];
  const nx = next ? `&next=${encodeURIComponent(next)}` : '';
  const m = ['login', 'signup', 'reset'].includes(mode) ? mode : 'login';
  const em = encodeURIComponent(email || '');
  return (
    <div className="wrap section narrow acct-login">
      <div className="panel">
        <h1>👤 অ্যাকাউন্ট খুলুন / লগইন করুন</h1>
        <p className="muted">{cur === 'email' ? 'ইমেইল আর পাসওয়ার্ড দিয়ে ঢুকুন। নতুন অ্যাকাউন্ট খোলার সময় ইমেইলে শুধু একবার একটা কোড যাবে।' : 'মোবাইলে একটা কোড যাবে — শুধু একবার। এরপর এই ফোনে লগইন থাকবে, অর্ডার করতে আর কোড লাগবে না।'}</p>
        {tabs.length > 1 ? <nav className="acct-tabs acct-login-tabs" aria-label="কীভাবে ঢুকবেন">{tabs.map(([k, l]) => <a key={k} href={`/account?via=${k}${nx}`} className={cur === k ? 'on' : ''} aria-current={cur === k ? 'page' : undefined}>{l}</a>)}</nav> : null}
        {info ? <p className="flash">{info}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        {!tabs.length ? <p className="note">এই মুহূর্তে অ্যাকাউন্ট খোলা যাচ্ছে না। লগইন ছাড়াই অর্ডার করুন, অথবা একটু পরে চেষ্টা করুন।</p>
          : cur === 'email' ? <EmailForm step={step} m={m} email={email} next={next} em={em} nx={nx} /> : <PhoneForm step={step} phone={phone} next={next} nx={nx} />}
        <ul className="acct-why small muted">
          <li>✅ একবার যাচাই — পরের প্রতিটা অর্ডারে আর কোড লাগবে না</li>
          <li>🧾 আগের সব অর্ডার এক জায়গায় — এক চাপে আবার অর্ডার</li>
          <li>📍 ঠিকানা সেভ থাকে, অর্ডারের সময় আর লিখতে হয় না</li>
          <li>↩️ ভুল/নষ্ট পণ্যের রিটার্ন আবেদন সহজে</li>
        </ul>
        <p className="center small muted">লগইন না করেও অর্ডার করা যায় (তখন প্রতিবার মোবাইলে কোড যাবে)।</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- dashboard
function AddressForm({ a, action = '/account/address', submit = 'সেভ করুন' }: { a: Loose; action?: string; submit?: string }) {
  return (
    <form method="post" action={action} className="form addr-form" data-geo-form="">
      {a.id ? <input type="hidden" name="id" value={a.id} /> : null}
      <div className="field-row">
        <div className="field"><label>নাম (ঐচ্ছিক, যেমন: বাসা / অফিস)</label><input name="label" maxLength={30} defaultValue={a.label || ''} /></div>
        <div className="field"><label>প্রাপকের নাম</label><input name="name" maxLength={80} defaultValue={a.name || ''} autoComplete="name" /></div>
        <div className="field"><label>প্রাপকের মোবাইল</label><input name="phone" inputMode="tel" maxLength={20} defaultValue={a.phone || ''} autoComplete="tel" /></div>
      </div>
      <div className="field-row">
        <div className="field"><label>জেলা</label><select name="district" required data-district="" data-value={a.district || 'Dhaka'}><option value="">লোড হচ্ছে…</option></select></div>
        <div className="field"><label>থানা / উপজেলা</label><select name="thana" required data-thana="" data-value={a.thana || ''}><option value="">আগে জেলা বাছুন</option></select></div>
      </div>
      <div className="field"><label>পূর্ণ ঠিকানা</label><textarea name="address" rows={2} maxLength={400} required placeholder="বাসা নং, রোড, এলাকা" defaultValue={a.address || ''} /></div>
      <label className="check"><input type="checkbox" name="is_default" value="1" defaultChecked={!!a.is_default} /> <span>এটাই আমার মূল ঠিকানা</span></label>{' '}
      <button className="btn btn-sm">{submit}</button>
    </form>
  );
}

function ReferralBox({ r, s }: { r: Loose; s: Settings }) {
  const base = String(s.site_url || '').replace(/\/+$/, '');
  const link = `${base}/?ref=${r.code}`;
  return (
    <section className="panel ref-box">
      <h2>🎁 বন্ধুকে আনুন, দুজনেই ছাড় পান</h2>
      <p>আপনার কোড বা লিংক দিয়ে কোনো নতুন কাস্টমার প্রথম অর্ডার করলে তিনি পাবেন <b>{money(r.friendGets)}</b> ছাড়{r.friendMin ? <> (কমপক্ষে {money(r.friendMin)} এর অর্ডারে)</> : null}।
        {' '}তার অর্ডার ডেলিভারি হলে আপনি পাবেন <b>{money(r.youGet)}</b> এর গিফট কার্ড — পরের কেনাকাটায় ব্যবহার করবেন।</p>
      <div className="ref-code"><span className="small muted">আপনার কোড</span><b className="mono" data-copy-text="">{r.code}</b></div>
      {base ? <div className="ref-code"><span className="small muted">আপনার লিংক</span><input readOnly defaultValue={link} className="mono" data-select-all="" /></div> : null}
      <div className="row-actions">
        <a className="btn btn-wa" href={`https://wa.me/?text=${encodeURIComponent(`${s.store_name} থেকে কিনুন, আমার কোড ${r.code} দিলে প্রথম অর্ডারে ৳${r.friendGets} ছাড় পাবেন${base ? ': ' + link : ''}`)}`} target="_blank" rel="noopener">WhatsApp এ পাঠান</a>{' '}
        <a className="btn btn-ghost" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`} target="_blank" rel="noopener">Facebook এ শেয়ার</a>
      </div>
      <p className="small muted">এখন পর্যন্ত: <b>{bn(r.joined)}</b> জন আপনার কোডে অর্ডার করেছেন, <b>{bn(r.rewarded)}</b>টা পুরস্কার পেয়েছেন।</p>
    </section>
  );
}

type DashProps = { cu: Loose; orders: Loose[]; addresses: Loose[]; settings: Settings; tab?: string; flash?: string; error?: string; referral?: Loose; cards?: Loose[]; welcome?: boolean; next?: string };

export function Dashboard({ cu, orders, addresses, settings: s, tab = 'orders', flash = '', error = '', referral = null, cards = [], welcome = false, next = '' }: DashProps) {
  const isEmail = !!cu.email_verified && !cu.phone;
  const dPhone = cu.phone || cu.contact_phone || '';
  const T = [['orders', '🧾 আমার অর্ডার'], ['addresses', '📍 ঠিকানা'], ['profile', '👤 প্রোফাইল']];
  if (referral) T.push(['refer', '🎁 বন্ধুকে আনুন']);
  if (s.gift_on === '1') T.push(['gift', '💳 গিফট কার্ড']);
  const reorderItems = (o: Loose) => (o.items || []).filter((i: Loose) => i.id && i.kind !== 'gift').map((i: Loose) => ({ id: i.id, qty: i.qty }));
  const returnable = (o: { status: string; }) => s.returns_on === '1' && o.status === 'delivered';
  return (
    <div className="wrap section acct">
      <div className="title-row"><h1>আসসালামু আলাইকুম{cu.name ? <>, <span translate="no">{cu.name.split(' ')[0]}</span></> : null}!</h1>
        <form method="post" action="/account/logout"><button className="btn btn-sm btn-ghost">লগআউট</button></form></div>
      <p className="muted small">{isEmail ? <>ইমেইল: <b translate="no">{cu.email}</b>{dPhone ? <> · মোবাইল: <b translate="no">{dPhone}</b></> : null}</> : <>মোবাইল: <b translate="no">{cu.phone}</b></>}{cu.points ? <> · লয়ালটি পয়েন্ট: <b>{bn(cu.points)}</b></> : null}</p>
      {flash ? <p className="flash">{flash}</p> : null}{error ? <p className="form-error">{error}</p> : null}
      {welcome ? null : <nav className="acct-tabs" aria-label="অ্যাকাউন্ট">{T.map(([k, l]) => <a key={k} href={`/account?tab=${k}`} className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined}>{l}</a>)}</nav>}
      {tab === 'orders' ? (
        <section className="panel">
          {orders.length ? <ul className="acct-orders">{orders.map((o) => (
            <li key={o.code}>
              <div><a href={`/order/${o.code}`}><b className="mono">{o.code}</b></a> <span className={`pill st-${o.status}`}>{O.STATUSES[o.status] || o.status}</span><br />
                <span className="small muted">{fmtDate(o.created_at)} · {bn((o.items || []).length)}টি পণ্য: {(o.items || []).map((i: Loose) => i.name).slice(0, 3).join(', ')}{(o.items || []).length > 3 ? '…' : ''}</span></div>
              <div className="acct-order-act"><b>{money(o.total)}</b>
                {' '}<a className="btn btn-sm btn-ghost" href={`/order/${o.code}`}>দেখুন</a>
                {reorderItems(o).length ? <>{' '}<button type="button" className="btn btn-sm" data-reorder={JSON.stringify(reorderItems(o))}>🔁 আবার অর্ডার</button></> : null}
                {returnable(o) ? <>{' '}<a className="btn btn-sm btn-ghost" href={`/order/${o.code}/return`}>↩️ রিটার্ন</a></> : null}</div>
            </li>))}</ul> : <div className="empty"><p>এখনো কোনো অর্ডার নেই।</p><a className="btn" href="/products">কেনাকাটা শুরু করুন</a></div>}
        </section>
      ) : null}
      {tab === 'addresses' ? (
        <>
          <section className="panel">
            {addresses.length ? <ul className="acct-addr">{addresses.map((a) => (
              <li key={a.id}><details><summary><b>{a.label || 'ঠিকানা'}</b>{a.is_default ? <> <span className="pill">মূল</span></> : null}<br />
                <span className="small">{a.name ? `${a.name}, ` : ''}{a.phone ? `${a.phone}, ` : ''}{a.address}, {O.areaLabel({ district: a.district, thana: a.thana })}</span> <span className="small link-like">✏️ এডিট</span></summary>
                <AddressForm a={a} />
                <form method="post" action="/account/address/delete" className="mt" data-confirm-shop="ঠিকানাটা মুছবেন?"><input type="hidden" name="id" value={a.id} /><button className="link-btn danger small">🗑️ মুছুন</button></form>
              </details></li>))}</ul> : <p className="muted">কোনো ঠিকানা সেভ করা নেই। নিচে যোগ করুন — অর্ডারের সময় নিজে থেকে বসে যাবে।</p>}
            <h2 className="mt">+ নতুন ঠিকানা</h2>
            <AddressForm a={{ name: cu.name, phone: dPhone }} submit="ঠিকানা সেভ করুন" />
          </section>
        </>
      ) : null}
      {tab === 'profile' ? (
        <section className="panel narrow-panel">
          {welcome ? <div className="success-banner"><div className="tick" aria-hidden="true">✓</div><h2>{isEmail ? 'ইমেইল যাচাই হয়েছে' : 'মোবাইল নম্বর যাচাই হয়েছে'} — অ্যাকাউন্ট তৈরি!</h2>
            <p>শেষ ধাপ: আপনার নাম{isEmail ? ' আর ডেলিভারির মোবাইল নম্বর' : ''} দিন। এরপর যেকোনো পণ্য অর্ডার করতে পারবেন — আর কোনো কোড লাগবে না।</p></div> : null}
          <form method="post" action="/account/profile" className="form">
            {welcome ? <input type="hidden" name="welcome" value="1" /> : null}{next ? <input type="hidden" name="next" value={next} /> : null}
            <div className="field"><label>আপনার নাম</label><input name="name" maxLength={80} required defaultValue={cu.name || ''} autoComplete="name" autoFocus={welcome} /></div>
            {isEmail ? (
              <>
                <div className="field"><label>মোবাইল নম্বর (ডেলিভারি আর অর্ডার কনফার্মের জন্য)</label><input name="contact_phone" inputMode="tel" maxLength={20} required defaultValue={cu.contact_phone || ''} autoComplete="tel" placeholder="01XXXXXXXXX" /></div>
                <p className="small muted">লগইনের ইমেইল: <b translate="no">{cu.email}</b> (এটা বদলানো যায় না)</p>
              </>
            ) : (
              <>
                <div className="field"><label>ইমেইল (ঐচ্ছিক)</label><input name="email" type="email" maxLength={120} defaultValue={cu.email || ''} autoComplete="email" /></div>
                <p className="small muted">মোবাইল নম্বর বদলাতে নতুন নম্বর দিয়ে আলাদা লগইন করুন, অথবা আমাদের জানান।</p>
              </>
            )}
            <button className={`btn ${welcome ? 'btn-lg btn-block' : ''}`}>{welcome ? (next === '/checkout' ? 'সেভ করে অর্ডারে যান' : 'সেভ করে কেনাকাটা শুরু করুন') : 'সেভ করুন'}</button>
          </form>
          {welcome ? null : <form method="post" action="/account/logout-all" className="mt"><button className="link-btn small">🔒 সব ফোন/কম্পিউটার থেকে লগআউট করুন</button></form>}
        </section>
      ) : null}
      {tab === 'refer' && referral ? <ReferralBox r={referral} s={s} /> : null}
      {tab === 'gift' && s.gift_on === '1' ? (
        <section className="panel">
          <h2>💳 আমার গিফট কার্ড</h2>
          {cards.length ? <ul className="acct-orders">{cards.map((c) => (
            <li key={c.code}><div><b className="mono">{c.code}</b> <span className="pill">{c.status === 'active' ? 'চালু' : c.status === 'pending' ? 'পেমেন্ট যাচাই চলছে' : c.status === 'used' ? 'শেষ' : c.status}</span><br />
              <span className="small muted">{c.source === 'referral' ? 'রেফারেলের পুরস্কার' : c.recipient_phone === cu.phone ? 'আপনাকে দেওয়া' : `আপনি কিনেছেন${c.recipient_name ? ` — ${c.recipient_name}` : ''}`}{c.expires_on ? ` · মেয়াদ ${c.expires_on}` : ''}</span></div>
              <div className="acct-order-act"><b>{money(c.balance)}</b> <span className="small muted">/ {money(c.initial)}</span></div></li>))}</ul>
            : <p className="muted">আপনার কোনো গিফট কার্ড নেই।</p>}
          <p><a className="btn btn-sm" href="/gift-card">🎁 গিফট কার্ড কিনুন</a></p>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- return request (customer)
export const REASONS = [['broken', 'ভাঙা / নষ্ট পণ্য এসেছে'], ['wrong', 'ভুল পণ্য এসেছে'], ['missing', 'পণ্য কম এসেছে / পার্টস নেই'], ['not_working', 'কাজ করছে না'],
  ['not_as_described', 'ছবি/বিবরণের সাথে মিলছে না'], ['warranty', 'ওয়ারেন্টি দাবি'], ['other', 'অন্য কারণ']];
export const WANTS = [['refund', '💵 টাকা ফেরত'], ['replace', '🔄 বদলে দিন (একই পণ্য)'], ['fix', '🛠️ মেরামত / ওয়ারেন্টি সার্ভিস']];
export const RETURN_LABELS: Record<string, string> = { requested: 'আবেদন পেয়েছি', approved: 'অনুমোদিত — পণ্য পাঠান', received: 'পণ্য ফেরত পেয়েছি', refunded: 'টাকা ফেরত দেওয়া হয়েছে', replaced: 'বদলে দেওয়া হয়েছে', rejected: 'গ্রহণ করা যায়নি', cancelled: 'বাতিল' };

function ReturnFormBody({ order, s, error, items }: { order: Loose; s: Settings; error: string; items: Loose[] }) {
  return (
    <form className="form panel" method="post" action={`/order/${order.code}/return`} data-return-form="">
      {error ? <p className="form-error">{error}</p> : null}
      <p className="muted small">পণ্য হাতে পাওয়ার {bn(Number(s.returns_days) || 7)} দিনের মধ্যে আবেদন করা যায়। যে পণ্য ফেরত দিতে চান টিক দিন আর পরিমাণ লিখুন।</p>
      <table className="lines"><tbody>{items.map((it) => (
        <tr key={it.id}><td><label className="check"><input type="checkbox" name="item" value={it.id} /> <span>{it.name}</span></label></td>
          <td className="num"><input type="number" name={`qty_${it.id}`} min="1" max={it.qty} defaultValue={it.qty} className="w-num" aria-label="পরিমাণ" /> / {bn(it.qty)}</td></tr>))}</tbody></table>
      <div className="field-row">
        <div className="field"><label>কারণ</label><select name="reason" required>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="field"><label>আপনি কী চান</label><select name="want">{WANTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>
      <div className="field"><label>বিস্তারিত লিখুন</label><textarea name="details" rows={3} maxLength={1000} required minLength={10} placeholder="কী সমস্যা হয়েছে, কবে খেয়াল করলেন…" /></div>
      <div className="field"><label>📷 ছবি (সমস্যাটা দেখা যায় এমন, সর্বোচ্চ ৪টা)</label><input type="file" accept="image/*" multiple data-return-photos="" />
        <div className="ret-thumbs" data-return-thumbs=""></div><input type="hidden" name="photos" value="" data-return-photo-data="" />{' '}
        <small>ছবি ছোট করে পাঠানো হয়। ছবি দিলে আবেদন দ্রুত যাচাই হয়।</small></div>
      <div className="field-row">
        <div className="field"><label>টাকা কোথায় নেবেন (টাকা ফেরত চাইলে)</label><select name="refund_method"><option value="bkash">বিকাশ</option><option value="nagad">নগদ</option><option value="rocket">রকেট</option><option value="bank">ব্যাংক</option><option value="cash">নগদ টাকা</option></select></div>
        <div className="field"><label>সেই নম্বর / অ্যাকাউন্ট</label><input name="refund_number" maxLength={60} inputMode="tel" placeholder="01XXXXXXXXX" /></div>
      </div>
      <input type="text" name="website" className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" />{' '}
      <button className="btn btn-amber btn-lg btn-block" data-return-submit="">আবেদন পাঠান</button>
      <p className="small muted center">আবেদন পাঠানো মানেই রিটার্ন নিশ্চিত না — আমরা দেখে জানাব। <a href="/page/return-policy">রিটার্ন নীতি</a></p>
    </form>
  );
}

export function ReturnForm({ order, existing = [], settings: s, error = '', done = null, mine }: { order: Loose; existing?: Loose[]; settings: Settings; error?: string; done?: Loose; mine?: boolean }) {
  const items = (order.items || []).filter((i: Loose) => i.product_id);
  let body: ReactNode;
  if (!mine) {
    body = <p className="note">আবেদন করতে আগে <a href={`/track?code=${order.code}`}>অর্ডার ট্র্যাক</a> পেজে অর্ডার নম্বর আর মোবাইল নম্বর দিন{s.acct_on === '1' ? <>, অথবা <a href={`/account?next=/order/${order.code}/return`}>লগইন করুন</a></> : null}।</p>;
  } else if (order.status !== 'delivered') {
    body = <p className="note">অর্ডার ডেলিভারি হওয়ার পর রিটার্নের আবেদন করা যায়। ডেলিভারির সময় সমস্যা দেখলে ডেলিভারিম্যানের সামনেই জানান।</p>;
  } else {
    body = <ReturnFormBody order={order} s={s} error={error} items={items} />;
  }
  return (
    <div className="wrap section narrow">
      <p className="crumbs"><a href={`/order/${order.code}`}>← অর্ডার {order.code}</a></p>
      <h1>↩️ রিটার্ন / রিফান্ড আবেদন</h1>
      {done ? <div className="success-banner"><div className="tick" aria-hidden="true">✓</div><h2>আবেদন পেয়েছি — নম্বর <span className="mono">{done}</span></h2><p>আমরা দেখে শীঘ্রই আপনার সাথে যোগাযোগ করব। এই পেজে আবেদনের অবস্থা দেখতে পাবেন।</p></div> : null}
      {existing.length ? <section className="panel"><h2>আপনার আবেদন</h2><ul className="acct-orders">{existing.map((r) => (
        <li key={r.code}><div><b className="mono">{r.code}</b> <span className="pill">{RETURN_LABELS[r.status] || r.status}</span><br />
          <span className="small muted">{fmtDate(r.created_at)} · {(r.items || []).map((i: Loose) => `${i.name} ×${bn(i.qty)}`).join(', ')}</span>
          {r.reply ? <><br /><span className="small"><b>{s.store_name}:</b> {r.reply}</span></> : null}</div>
          <div className="acct-order-act">{Number(r.refund_amount) ? <><b>{money(r.refund_amount)}</b> ফেরত</> : null}</div></li>))}</ul></section> : null}
      {body}
    </div>
  );
}

// ---------------------------------------------------------------- gift card page
export function GiftPage({ settings: s, methods = [], error = '', done = null, values = {} }: { settings: Settings; methods?: Loose[]; error?: string; done?: Loose; values?: Loose }) {
  const amounts = String(s.gift_amounts || '500,1000,2000,5000').split(',').map((x) => Number(x)).filter((x) => x > 0).slice(0, 8);
  const min = Number(s.gift_min) || 200; const max = Number(s.gift_max) || 20000;
  const checkedAmount = (a: number, i: number) => Number(values.amount || amounts[1] || amounts[0]) === a || (i === 0 && !values.amount && amounts.length === 1);
  return (
    <div className="wrap section narrow">
      <h1>🎁 গিফট কার্ড</h1>
      <p className="muted">প্রিয়জনকে উপহার দিন — তিনি নিজের পছন্দে {s.store_name} থেকে কিনবেন। গিফট কার্ডের কোড SMS-এ যাবে, চেকআউটে কোড দিলেই টাকা কাটা যাবে। {Number(s.gift_valid_days) ? `মেয়াদ ${bn(s.gift_valid_days)} দিন।` : ''}</p>
      {done ? <div className="success-banner"><div className="tick" aria-hidden="true">✓</div><h2>অনুরোধ পেয়েছি!</h2><p>আপনার পাঠানো টাকা (TrxID <b className="mono">{done.trx}</b>) যাচাই করে গিফট কার্ড চালু করা হবে, আর কোড SMS-এ যাবে <b>{done.to}</b> নম্বরে।</p></div> : (
        <form method="post" action="/gift-card" className="form panel" data-gift-form="">
          {error ? <p className="form-error">{error}</p> : null}
          <div className="field"><span className="label">পরিমাণ</span><div className="gift-amounts">{amounts.map((a, i) => <label key={a} className="gift-amt"><input type="radio" name="amount" value={a} defaultChecked={checkedAmount(a, i)} /><span>{money(a)}</span></label>)}{' '}
            <label className="gift-amt"><input type="radio" name="amount" value="custom" defaultChecked={values.amount === 'custom'} /><span>অন্য</span></label></div>
            <input name="custom_amount" type="number" min={min} max={max} defaultValue={values.custom_amount || ''} placeholder={`${bn(min)} – ${bn(max)} টাকা`} className="mt" data-gift-custom="" /></div>
          <h2>কাকে দেবেন</h2>
          <div className="field-row">
            <div className="field"><label>প্রাপকের নাম</label><input name="recipient_name" maxLength={80} required defaultValue={values.recipient_name || ''} /></div>
            <div className="field"><label>প্রাপকের মোবাইল (কোড এখানে যাবে)</label><input name="recipient_phone" inputMode="tel" maxLength={20} required defaultValue={values.recipient_phone || ''} /></div>
          </div>
          <div className="field"><label>শুভেচ্ছা বার্তা (ঐচ্ছিক)</label><input name="message" maxLength={120} defaultValue={values.message || ''} placeholder="যেমন: শুভ জন্মদিন!" /></div>
          <h2>আপনার তথ্য</h2>
          <div className="field-row">
            <div className="field"><label>আপনার নাম</label><input name="buyer_name" maxLength={80} required defaultValue={values.buyer_name || ''} autoComplete="name" /></div>
            <div className="field"><label>আপনার মোবাইল</label><input name="buyer_phone" inputMode="tel" maxLength={20} required defaultValue={values.buyer_phone || ''} autoComplete="tel" /></div>
          </div>
          <h2>পেমেন্ট (Send Money)</h2>
          {methods.length ? (
            <>
              <div className="pay-methods">{methods.map((m, i) => <label key={m.id} className="pay-opt"><input type="radio" name="pay_method" value={m.id} defaultChecked={i === 0} /><span><b>{m.label}</b><small>{m.number} ({s.manual_type || 'Personal'}) নম্বরে Send Money করুন</small></span></label>)}</div>
              <div className="field-row">
                <div className="field"><label>যে নম্বর থেকে পাঠিয়েছেন</label><input name="pay_number" inputMode="tel" maxLength={20} required defaultValue={values.pay_number || ''} /></div>
                <div className="field"><label>Transaction ID (TrxID)</label><input name="trx" maxLength={40} required autoCapitalize="characters" defaultValue={values.trx || ''} /></div>
              </div>
              <input type="text" name="website" className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" />{' '}
              <button className="btn btn-amber btn-lg btn-block">অনুরোধ পাঠান</button>
              <p className="small muted center">টাকা যাচাই হলে গিফট কার্ড চালু হবে (সাধারণত কয়েক ঘণ্টার মধ্যে)।</p>
            </>
          ) : <p className="note">এখন অনলাইনে গিফট কার্ড বিক্রি বন্ধ আছে। কিনতে আমাদের কল করুন বা দোকানে আসুন।</p>}
        </form>
      )}
      <section className="panel mt"><h2>গিফট কার্ডে কত আছে দেখুন</h2>
        <form className="coupon-row" data-gift-check=""><input name="code" placeholder="গিফট কার্ডের কোড" maxLength={30} autoCapitalize="characters" /><button className="btn btn-sm btn-ghost">দেখুন</button></form>
        <p className="small" data-gift-check-msg="" role="status"></p></section>
    </div>
  );
}
