// 🚀 ল্যান্ডিং পেজ (/lp/<slug>) — one product sold on one page, for ads. Order of the page is the classic sales order:
// what it is + price + "order now" → why buy (benefits) → see it (pictures, video) → proof (reviews, sold count) →
// doubts answered (questions) → the order form, right here. A bar at the bottom keeps "অর্ডার করুন" one tap away.
// The order form is the shop's own checkout (same delivery charges, OTP, fraud checks, pixels): the browser code puts
// just this product in the cart (client/shop/landing.tsx), so the form's summary shows it.
import { Val, RawHtml, attrValue, jsxList } from '../react/html';
import { money, bn, youtubeId, contact, qtyRule, packSizes, packRule } from '../util';
import * as md from './md';
import * as shop from './shop';
import * as L from '../models/landing';
import type { ReactNode } from 'react';
import type { Settings } from '../types';
import type { LandingPagesRow } from '../data/rows';
import type { FullProduct, Product } from '../models/catalog';
import type { ReviewStats, ShownReview } from '../models/reviews';

export type LandingViewProps = {
  page: LandingPagesRow; product: FullProduct; settings: Settings; reviews: ShownReview[]; reviewStats: Partial<ReviewStats> & { count: number };
  checkout: ReactNode; hasCod?: boolean;
};

/** The questions every buyer has, answered from the shop's own settings (never a promise the shop doesn't make). */
export function defaultFaq(s: Settings, hasCod: boolean): { q: string; a: string }[] {
  const C = contact(s);
  const out = [
    { q: 'ডেলিভারি কতদিনে পাব?', a: `ঢাকা সিটিতে ${shop.delText(s.del_days_dhaka, '1-2')} (চার্জ ${money(s.delivery_dhaka)}), ঢাকার বাইরে ${shop.delText(s.del_days_outside, '2-4')} (চার্জ ${money(s.delivery_outside)})।` },
  ];
  if (hasCod) out.push({ q: 'টাকা কখন দিতে হবে?', a: 'পণ্য হাতে পেয়ে দেখে টাকা দিন — ক্যাশ অন ডেলিভারি।' });
  out.push({ q: 'অর্ডার করার পর কী হবে?', a: 'আমরা ফোন করে অর্ডার কনফার্ম করব, তারপর পাঠিয়ে দেব। অর্ডার নম্বর দিয়ে যেকোনো সময় ট্র্যাক করতে পারবেন।' });
  if (C.phone) out.push({ q: 'আর কিছু জানার থাকলে?', a: `কল করুন ${C.phone} নম্বরে।` });
  return out;
}

/** The product the cart gets: a product with colours/sizes → its first one in stock (the order form can switch it). */
export function cartProduct(p: FullProduct): Product {
  const V = Array.isArray(p.variants) ? p.variants : [];
  return V.find((v) => v.stock > 0) || V[0] || p;
}

export function landingPage({ page: lp, product: p, settings: s, reviews, reviewStats, checkout, hasCod = true }: LandingViewProps) {
  const cur = cartProduct(p);
  const off = shop.discount(cur);
  const packs = packSizes(p.pack_sizes);
  const R = packRule(qtyRule(s, cur.price), packs);
  const preorderOk = !!p.preorder;
  const out = cur.stock <= 0 && !preorderOk;
  const maxQ = preorderOk ? R.max : Math.max(R.min, Math.min(cur.stock, R.max));
  const images = p.images || [];
  const big = (id: number) => (s.wm_on === '1' && s.wm_ver ? `/media/${id}/w?v=${s.wm_ver}.r2` : `/media/${id}`);
  const points = L.lines(lp.points);
  const yt = youtubeId(lp.video_url) || youtubeId(p.youtube_url);
  // countdown: the page's own end time, or the flash sale's while it runs
  const endMs = lp.ends_at ? new Date(lp.ends_at).getTime() : 0;
  const ends = endMs > Date.now() ? new Date(endMs).toISOString() : (cur.flash_ends ? new Date(cur.flash_ends).toISOString() : '');
  const C = contact(s);
  const faq = [...L.faqPairs(lp.faq), ...defaultFaq(s, hasCod)];
  const sold = Number(p.sold_count) || 0;
  const low = !out && cur.stock > 0 && cur.stock <= Math.max(5, Number(cur.low_stock) || 0);
  const desc = p.description ? md.render(p.description, { productCard: true }) : '';
  const orderBtn = (cls = '') => (out ? null : <a className={`btn btn-amber btn-lg lp-cta ${cls}`} href="#order" data-lp-go="">🛒 এখনই অর্ডার করুন</a>);

  return (<div className="lp" data-lp="" data-lp-product={attrValue(cur.id)} data-lp-price={attrValue(cur.price)} data-lp-min={attrValue(R.min)} data-lp-max={attrValue(maxQ)} data-lp-packs={packs.length ? packs.join(',') : undefined}>
    <section className="lp-hero"><div className="wrap lp-hero-in">
      <div className="lp-gallery">
        <div className="lp-main">{(images.length ? <img src={attrValue(big(images[0]))} alt={attrValue(p.name)} data-lp-main="" draggable="false" fetchpriority="high" /> : <span className="emoji"><Val v={p.emoji || '📦'} /></span>)}{(off ? <span className="badge-off">{bn(off)}% ছাড়</span> : null)}</div>
        {(images.length > 1 ? <div className="lp-thumbs">{jsxList(images.slice(0, 8).map((id, i) => <button type="button" className={`lp-thumb ${i === 0 ? 'on' : ''}`} data-lp-img={attrValue(big(id))} aria-label={`ছবি ${bn(i + 1)}`}><img src={`/media/${attrValue(id)}/t`} alt="" loading="lazy" draggable="false" /></button>))}</div> : null)}
      </div>
      <div className="lp-info">
        {(lp.offer ? <p className="lp-offer">🎁 <Val v={lp.offer} /></p> : null)}
        <h1 className="lp-h1"><Val v={lp.headline || p.name} /></h1>
        {(lp.subhead ? <p className="lp-sub"><Val v={lp.subhead} /></p> : null)}
        {(reviewStats.count && s.reviews_on !== '0' ? <a className="lp-rating" href="#reviews">{shop.stars(reviewStats.avg)} {bn(Number(reviewStats.avg).toFixed(1))} · {bn(reviewStats.count)}টি রিভিউ</a> : null)}
        <div className="lp-price"><span className="price">{money(cur.price)}</span>{(packs.length ? <span className="per-pc">/ পিস</span> : null)}{(off ? <><s className="old-price">{money(cur.old_price)}</s><span className="save">{money(Number(cur.old_price) - cur.price)} সাশ্রয়</span></> : null)}</div>
        {(ends ? <p className="lp-timer">⏰ অফার শেষ হতে বাকি: <b className="countdown" data-countdown={attrValue(ends)}></b></p> : null)}
        {(out ? <p className="stock out">এই মুহূর্তে স্টকে নেই{(C.phone ? <> — জানতে কল করুন <a href={`tel:${attrValue(C.phone)}`}><Val v={C.phone} /></a></> : null)}</p>
          : <p className={`stock ${low ? 'low' : 'ok'}`}>{(cur.stock <= 0 ? '⏳ প্রি-অর্ডার চলছে' : low ? `🔥 মাত্র ${bn(cur.stock)}টি বাকি` : '✓ স্টকে আছে')}{(sold > 0 && s.ui_pdp_sold !== '0' ? <> · এ পর্যন্ত <b>{bn(sold)}টি</b> বিক্রি</> : null)}</p>)}
        {(out ? null : <div className="lp-buy"><div className="qty" data-lp-qty=""><button type="button" data-lp-step="-1" aria-label="কমান">−</button><input type="number" min={attrValue(R.min)} max={attrValue(maxQ)} step={packs.length ? String(R.step) : undefined} defaultValue={attrValue(R.min)} aria-label="পরিমাণ" data-lp-n="" /><button type="button" data-lp-step="1" aria-label="বাড়ান">+</button></div>{orderBtn()}</div>)}
        {(C.phone || C.waButton ? <p className="lp-call small">{(C.phone ? <>📞 ফোনেও অর্ডার: <a href={`tel:${attrValue(C.phone)}`}><b><Val v={C.phone} /></b></a></> : null)}{(C.waButton ? <> · <a href={`https://wa.me/${attrValue(C.waButton)}?text=${attrValue(encodeURIComponent(`${p.name} — অর্ডার করতে চাই`))}`} target="_blank" rel="noopener">💬 WhatsApp</a></> : null)}</p> : null)}
      </div>
    </div></section>
    <div className="wrap">{shop.trustItems(s, 'lp-trust')}</div>
    {(points.length ? <section className="wrap lp-sec"><h2>কেন এটা নেবেন</h2><ul className="lp-points">{jsxList(points.map((t) => <li><span aria-hidden="true">✅</span> <Val v={t} /></li>))}</ul>{orderBtn('lp-cta-mid')}</section> : null)}
    {(yt ? <section className="wrap lp-sec"><h2>▶ ভিডিওতে দেখুন</h2>{shop.videoBox(yt, p.name)}</section> : null)}
    {(desc ? <section className="wrap lp-sec"><details className="lp-desc" open={images.length < 2 && !points.length}><summary><h2>📋 পণ্যের বিস্তারিত</h2></summary><div className="rich"><RawHtml html={desc} /></div>{(images.length > 1 ? <div className="lp-pics">{jsxList(images.slice(1, 6).map((id) => <img src={`/media/${attrValue(id)}`} alt={attrValue(p.name)} loading="lazy" draggable="false" />))}</div> : null)}</details></section> : null)}
    <div className="wrap">{shop.reviewsBlock(p, s, reviews, reviewStats)}</div>
    <section className="wrap lp-sec"><h2>❓ সাধারণ প্রশ্ন</h2><div className="lp-faq">{jsxList(faq.map((f) => <details><summary><Val v={f.q} /></summary><p><Val v={f.a} /></p></details>))}</div></section>
    {(out ? null : checkout)}
    <p className="wrap small muted center lp-more"><a href={`/p/${attrValue(p.slug)}`}>পণ্যের পুরো পেজ দেখুন</a> · <a href="/products">আরও পণ্য দেখুন</a></p>
    {(out ? null : <div className="lp-bar" data-lp-bar=""><div><b>{money(cur.price)}</b>{(off ? <s>{money(cur.old_price)}</s> : null)}</div><a className="btn btn-amber" href="#order" data-lp-go="">🛒 অর্ডার করুন</a></div>)}
  </div>);
}
