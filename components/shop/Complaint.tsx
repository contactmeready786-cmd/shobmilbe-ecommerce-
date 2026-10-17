// ⚛️ 📮 Customer pages for complaints: the form (/complaint) and "my complaint's status" (/complaint/status).
// Moved from lib/views/complaint.ts (2026-10-17); same HTML as before.
import { bn, fmtDate, contact } from '../../lib/util';
import * as C from '../../lib/models/complaints';
import type { Loose, Settings } from '../../lib/types';

function StatusBox({ c }: { c: Loose }) {
  const [ic, label] = C.STATUS[c.status] || ['', c.status];
  return (
    <section className="panel complaint-status">
      <p className="small muted">অভিযোগ নম্বর</p><h2 className="mono">{c.code}</h2>
      <p className={`cs-state cs-${c.status}`}>{ic} {label}</p>
      <ul className="cs-facts">
        <li>বিষয়: <b>{C.TOPICS[c.topic] || c.topic}</b>{c.order_code ? <> · অর্ডার <b className="mono">{c.order_code}</b></> : null}</li>
        <li>জমা দিয়েছেন: {fmtDate(c.created_at)}</li>
        {C.OPEN.includes(c.status) ? <li>সমাধানের শেষ সময়: <b>{fmtDate(c.due_at)}</b></li> : c.resolved_at ? <li>শেষ হয়েছে: {fmtDate(c.resolved_at)}</li> : null}
      </ul>
      <details><summary>আপনার লেখা</summary><p className="pre">{c.message}</p></details>
      {c.replies && c.replies.length
        ? <><h3>আমাদের উত্তর</h3><ul className="cs-replies">{c.replies.map((r: Loose, i: number) => <li key={i}><p className="pre">{r.body}</p><small className="muted">{fmtDate(r.created_at)}</small></li>)}</ul></>
        : <p className="muted small">এখনো উত্তর দেওয়া হয়নি — আমরা দেখছি। উত্তর দিলে SMS-এও জানানো হবে।</p>}
    </section>
  );
}

function WarrantyPart({ values }: { values: Loose }) {
  if (values.item_name) {
    return <><p>🛡️ <b>ওয়ারেন্টি দাবি:</b> <span translate="no">{values.item_name}</span>{values.item_end ? <> <span className="small muted">(ওয়ারেন্টি {fmtDate(values.item_end, false)} পর্যন্ত)</span></> : null}</p><input type="hidden" name="item" value={values.item} /></>;
  }
  if (values.items && values.items.length) {
    return (
      <div className="field"><label>কোন পণ্যের ওয়ারেন্টি?</label><select name="item">{values.items.map((x: Loose) => (
        <option key={x.product_id} value={x.product_id} disabled={!x.valid}>{x.name}{x.valid ? '' : ' (মেয়াদ শেষ)'}</option>))}</select></div>
    );
  }
  return <input type="hidden" name="item" value={values.item || ''} />;
}

export function ComplaintPage({ settings: s, values = {}, error = '', done = null, look = null, lookError = '' }: { settings: Settings; values?: Loose; error?: string; done?: Loose; look?: Loose; lookError?: string }) {
  const hrs = C.hoursOf(s);
  const ct = contact(s);
  if (done) {
    return (
      <div className="wrap section narrow">
        <h1>✅ অভিযোগ জমা হয়েছে</h1>
        <p>আপনার অভিযোগ নম্বর <b className="mono big-code">{done.code}</b> — নম্বরটা লিখে রাখুন{s.complaint_sms_on !== '0' ? ' (SMS-এও পাঠানো হয়েছে)' : ''}।</p>
        <p>আমরা <b>{bn(hrs)} ঘণ্টার মধ্যে</b> সমাধান করব। অবস্থা দেখতে যেকোনো সময় নিচের লিংকে অভিযোগ নম্বর আর মোবাইল নম্বর দিন।</p>
        <p><a className="btn" href={`/complaint/status?code=${done.code}`}>অভিযোগের অবস্থা দেখুন</a> <a className="btn btn-ghost" href="/">দোকানে ফিরে যান</a></p>
      </div>
    );
  }
  return (
    <div className="wrap section narrow complaint-page">
      <h1>📮 অভিযোগ / সমস্যা জানান</h1>
      <p className="muted">অর্ডার, পণ্য, ডেলিভারি বা টাকা নিয়ে কোনো সমস্যা হলে এখানে লিখুন। প্রতিটা অভিযোগ রেকর্ডে থাকে এবং <b>{bn(hrs)} ঘণ্টার মধ্যে</b> সমাধান করা হয়।
        {ct.phone ? <> জরুরি হলে কল করুন: <a href={`tel:${ct.phone}`}>{ct.phone}</a>।</> : null}</p>
      <form className="form panel" method="post" action="/complaint" data-complaint-form="">
        {error ? <p className="form-error">{error}</p> : null}
        <div className="field-row">
          <div className="field"><label htmlFor="c-name">আপনার নাম</label><input id="c-name" name="name" required maxLength={80} autoComplete="name" defaultValue={values.name || ''} /></div>
          <div className="field"><label htmlFor="c-phone">মোবাইল নম্বর</label><input id="c-phone" name="phone" required inputMode="tel" maxLength={20} autoComplete="tel" placeholder="01XXXXXXXXX" defaultValue={values.phone || ''} /></div>
        </div>
        <div className="field-row">
          <div className="field"><label htmlFor="c-order">অর্ডার নম্বর (থাকলে)</label><input id="c-order" name="order_code" maxLength={20} autoCapitalize="characters" placeholder="যেমন SMAB12CD" defaultValue={values.order_code || ''} /></div>
          <div className="field"><label htmlFor="c-topic">বিষয়</label><select id="c-topic" name="topic" defaultValue={values.topic}>{Object.entries(C.TOPICS).map(([k, v]) => <option key={k} value={k}>{v as string}</option>)}</select></div>
        </div>
        {values.topic === 'warranty' ? (
          <div className="warranty-claim">
            <WarrantyPart values={values} />
            <p className="small muted">পণ্যটি কী সমস্যা করছে লিখুন আর ছবি/ভিডিওর স্ক্রিনশট দিন। যাচাই করে রিপ্লেসমেন্ট বা সার্ভিসের ব্যবস্থা জানানো হবে। ভুল ব্যবহার, পানি লাগা, পড়ে ভাঙা বা নিজে খুললে ওয়ারেন্টি থাকে না।</p>
          </div>
        ) : null}
        <div className="field"><label htmlFor="c-msg">কী সমস্যা হয়েছে, বিস্তারিত লিখুন</label><textarea id="c-msg" name="message" rows={5} required minLength={10} maxLength={2000} defaultValue={values.message || ''} /></div>
        <div className="field"><label>📷 ছবি (থাকলে, সর্বোচ্চ ৪টা)</label><input type="file" accept="image/*" multiple data-return-photos="" />
          <div className="ret-thumbs" data-return-thumbs=""></div><input type="hidden" name="photos" value="" data-return-photo-data="" />{' '}
          <small>ভাঙা/ভুল পণ্যের ছবি দিলে দ্রুত সমাধান হয়। ছবি শুধু আমাদের স্টাফ দেখতে পারেন।</small></div>
        <div className="field"><label htmlFor="c-email">ইমেইল (ঐচ্ছিক)</label><input id="c-email" name="email" type="email" maxLength={120} autoComplete="email" defaultValue={values.email || ''} /></div>
        <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />{' '}
        <button className="btn btn-amber btn-lg btn-block">অভিযোগ জমা দিন</button>
        <p className="small muted">আপনার নাম, নম্বর ও লেখা শুধু এই অভিযোগ সমাধানের জন্য রাখা হয়। <a href="/page/privacy-policy">প্রাইভেসি পলিসি</a></p>
      </form>
      <section className="panel" id="status">
        <h2>আগের অভিযোগের অবস্থা দেখুন</h2>
        <form className="form" method="get" action="/complaint/status">
          <div className="field-row">
            <div className="field"><label htmlFor="s-code">অভিযোগ নম্বর</label><input id="s-code" name="code" required maxLength={12} autoCapitalize="characters" placeholder="C123456" defaultValue={look ? look.code : ''} /></div>
            <div className="field"><label htmlFor="s-phone">মোবাইল নম্বর</label><input id="s-phone" name="phone" required inputMode="tel" maxLength={20} placeholder="01XXXXXXXXX" /></div>
          </div>
          <button className="btn">দেখুন</button>
          {lookError ? <p className="form-error">{lookError}</p> : null}
        </form>
      </section>
    </div>
  );
}

export function StatusPage({ c = null, code = '', error = '' }: { c?: Loose; code?: string; error?: string }) {
  return (
    <div className="wrap section narrow">
      <h1>📮 অভিযোগের অবস্থা</h1>
      {c ? <StatusBox c={c} /> : (
        <form className="form panel" method="get" action="/complaint/status">
          {error ? <p className="form-error">{error}</p> : null}
          <div className="field-row">
            <div className="field"><label htmlFor="s-code2">অভিযোগ নম্বর</label><input id="s-code2" name="code" required maxLength={12} autoCapitalize="characters" placeholder="C123456" defaultValue={code} /></div>
            <div className="field"><label htmlFor="s-phone2">যে মোবাইল নম্বর দিয়েছিলেন</label><input id="s-phone2" name="phone" required inputMode="tel" maxLength={20} placeholder="01XXXXXXXXX" /></div>
          </div>
          <button className="btn">দেখুন</button></form>
      )}
      <p><a href="/complaint">+ নতুন অভিযোগ জানান</a></p>
    </div>
  );
}
