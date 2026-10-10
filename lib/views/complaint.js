'use strict';
// 📮 Customer pages for complaints: the form (/complaint) and "my complaint's status" (/complaint/status).
const { html, raw, bn, fmtDate, contact } = require('../util');
const C = require('../models/complaints');

function statusBox(c) {
  const [ic, label] = C.STATUS[c.status] || ['', c.status];
  return html`<section class="panel complaint-status">
    <p class="small muted">অভিযোগ নম্বর</p><h2 class="mono">${c.code}</h2>
    <p class="cs-state cs-${c.status}">${ic} ${label}</p>
    <ul class="cs-facts">
      <li>বিষয়: <b>${C.TOPICS[c.topic] || c.topic}</b>${c.order_code ? html` · অর্ডার <b class="mono">${c.order_code}</b>` : ''}</li>
      <li>জমা দিয়েছেন: ${fmtDate(c.created_at)}</li>
      ${C.OPEN.includes(c.status) ? html`<li>সমাধানের শেষ সময়: <b>${fmtDate(c.due_at)}</b></li>` : c.resolved_at ? html`<li>শেষ হয়েছে: ${fmtDate(c.resolved_at)}</li>` : ''}
    </ul>
    <details><summary>আপনার লেখা</summary><p class="pre">${c.message}</p></details>
    ${c.replies && c.replies.length ? html`<h3>আমাদের উত্তর</h3><ul class="cs-replies">${c.replies.map((r) => html`<li><p class="pre">${r.body}</p><small class="muted">${fmtDate(r.created_at)}</small></li>`)}</ul>`
    : html`<p class="muted small">এখনো উত্তর দেওয়া হয়নি — আমরা দেখছি। উত্তর দিলে SMS-এও জানানো হবে।</p>`}
  </section>`;
}

function complaintPage({ settings: s, values = {}, error = '', done = null, look = null, lookError = '' }) {
  const hrs = C.hoursOf(s);
  const ct = contact(s);
  if (done) {
    return html`<div class="wrap section narrow">
  <h1>✅ অভিযোগ জমা হয়েছে</h1>
  <p>আপনার অভিযোগ নম্বর <b class="mono big-code">${done.code}</b> — নম্বরটা লিখে রাখুন${s.complaint_sms_on !== '0' ? ' (SMS-এও পাঠানো হয়েছে)' : ''}।</p>
  <p>আমরা <b>${bn(hrs)} ঘণ্টার মধ্যে</b> সমাধান করব। অবস্থা দেখতে যেকোনো সময় নিচের লিংকে অভিযোগ নম্বর আর মোবাইল নম্বর দিন।</p>
  <p><a class="btn" href="/complaint/status?code=${done.code}">অভিযোগের অবস্থা দেখুন</a> <a class="btn btn-ghost" href="/">দোকানে ফিরে যান</a></p>
</div>`;
  }
  return html`<div class="wrap section narrow complaint-page">
  <h1>📮 অভিযোগ / সমস্যা জানান</h1>
  <p class="muted">অর্ডার, পণ্য, ডেলিভারি বা টাকা নিয়ে কোনো সমস্যা হলে এখানে লিখুন। প্রতিটা অভিযোগ রেকর্ডে থাকে এবং <b>${bn(hrs)} ঘণ্টার মধ্যে</b> সমাধান করা হয়।
    ${ct.phone ? html`জরুরি হলে কল করুন: <a href="tel:${ct.phone}">${ct.phone}</a>।` : ''}</p>
  <form class="form panel" method="post" action="/complaint" data-complaint-form>
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <div class="field-row">
      <div class="field"><label for="c-name">আপনার নাম</label><input id="c-name" name="name" required maxlength="80" autocomplete="name" value="${values.name || ''}"></div>
      <div class="field"><label for="c-phone">মোবাইল নম্বর</label><input id="c-phone" name="phone" required inputmode="tel" maxlength="20" autocomplete="tel" placeholder="01XXXXXXXXX" value="${values.phone || ''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="c-order">অর্ডার নম্বর (থাকলে)</label><input id="c-order" name="order_code" maxlength="20" autocapitalize="characters" placeholder="যেমন SMAB12CD" value="${values.order_code || ''}"></div>
      <div class="field"><label for="c-topic">বিষয়</label><select id="c-topic" name="topic">${Object.entries(C.TOPICS).map(([k, v]) => html`<option value="${k}" ${values.topic === k ? raw('selected') : ''}>${v}</option>`)}</select></div>
    </div>
    <div class="field"><label for="c-msg">কী সমস্যা হয়েছে, বিস্তারিত লিখুন</label><textarea id="c-msg" name="message" rows="5" required minlength="10" maxlength="2000">${values.message || ''}</textarea></div>
    <div class="field"><label>📷 ছবি (থাকলে, সর্বোচ্চ ৪টা)</label><input type="file" accept="image/*" multiple data-return-photos>
      <div class="ret-thumbs" data-return-thumbs></div><input type="hidden" name="photos" value="" data-return-photo-data>
      <small>ভাঙা/ভুল পণ্যের ছবি দিলে দ্রুত সমাধান হয়। ছবি শুধু আমাদের স্টাফ দেখতে পারেন।</small></div>
    <div class="field"><label for="c-email">ইমেইল (ঐচ্ছিক)</label><input id="c-email" name="email" type="email" maxlength="120" autocomplete="email" value="${values.email || ''}"></div>
    <input type="text" name="website" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">
    <button class="btn btn-amber btn-lg btn-block">অভিযোগ জমা দিন</button>
    <p class="small muted">আপনার নাম, নম্বর ও লেখা শুধু এই অভিযোগ সমাধানের জন্য রাখা হয়। <a href="/page/privacy-policy">প্রাইভেসি পলিসি</a></p>
  </form>
  <section class="panel" id="status">
    <h2>আগের অভিযোগের অবস্থা দেখুন</h2>
    <form class="form" method="get" action="/complaint/status">
      <div class="field-row">
        <div class="field"><label for="s-code">অভিযোগ নম্বর</label><input id="s-code" name="code" required maxlength="12" autocapitalize="characters" placeholder="C123456" value="${look ? look.code : ''}"></div>
        <div class="field"><label for="s-phone">মোবাইল নম্বর</label><input id="s-phone" name="phone" required inputmode="tel" maxlength="20" placeholder="01XXXXXXXXX"></div>
      </div>
      <button class="btn">দেখুন</button>
      ${lookError ? html`<p class="form-error">${lookError}</p>` : ''}
    </form>
  </section>
</div>`;
}

function statusPage({ c = null, code = '', error = '' }) {
  return html`<div class="wrap section narrow">
  <h1>📮 অভিযোগের অবস্থা</h1>
  ${c ? statusBox(c) : html`<form class="form panel" method="get" action="/complaint/status">
    ${error ? html`<p class="form-error">${error}</p>` : ''}
    <div class="field-row">
      <div class="field"><label for="s-code2">অভিযোগ নম্বর</label><input id="s-code2" name="code" required maxlength="12" autocapitalize="characters" placeholder="C123456" value="${code}"></div>
      <div class="field"><label for="s-phone2">যে মোবাইল নম্বর দিয়েছিলেন</label><input id="s-phone2" name="phone" required inputmode="tel" maxlength="20" placeholder="01XXXXXXXXX"></div>
    </div>
    <button class="btn">দেখুন</button></form>`}
  <p><a href="/complaint">+ নতুন অভিযোগ জানান</a></p>
</div>`;
}

module.exports = { complaintPage, statusPage };
