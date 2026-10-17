// ⚛️ Every e-mail the shop sends, drawn with React (the same way as the pages) and turned into HTML text only at
// the moment it is sent. E-mail programs need the look written on each tag (style={…}); text is always escaped.
import type { CSSProperties, ReactNode } from 'react';
import { loadRenderer, renderHtml } from './react/render';

/** A mail drawn with React → its HTML text (a whole document when `doc` is set). */
export async function emailHtml(node: ReactNode, doc = false): Promise<string> {
  await loadRenderer();
  const body = renderHtml(node);
  return doc ? `<!doctype html>${body}` : body;
}

/** Lines of text with their line breaks kept. */
function Lines({ text }: { text: string }) {
  const parts = String(text).split('\n');
  return <>{parts.map((line, i) => <span key={i}>{i ? <br /> : null}{line}</span>)}</>;
}

/** A plain-text message as a simple mail (alerts, auto-call results, number checks). */
export function PlainEmail({ text, font = 'sans-serif' }: { text: string; font?: string }) {
  return <pre style={{ fontFamily: font, fontSize: 15, whiteSpace: 'pre-wrap' }}>{text}</pre>;
}

// ---------------------------------------------------------------- 🛒 new order (to the owner)
export type OrderMail = {
  code: string; name: string; phone: string; address: string; thana: string; district: string;
  lines: { name: string; qty: number; amount: string }[]; total: string; pay: string; note?: string; link: string;
};
const cell: CSSProperties = { padding: '4px 8px', borderBottom: '1px solid #eee' };
export function OrderEmail({ o }: { o: OrderMail }) {
  return (
    <div style={{ fontFamily: 'Arial,sans-serif', fontSize: 15, lineHeight: 1.6, color: '#222' }}>
      <h2 style={{ margin: '0 0 8px', color: '#0a7d3b' }}>🛒 নতুন অর্ডার এসেছে — {o.code}</h2>
      <p><b>কাস্টমার:</b> {o.name}<br /><b>মোবাইল:</b> {o.phone}<br />
        <b>ঠিকানা:</b> {o.address}, {o.thana}, {o.district}</p>
      <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 520 }}><tbody>
        {o.lines.map((l, i) => (
          <tr key={i}><td style={cell}>{l.name}</td><td style={{ ...cell, textAlign: 'right' }}>× {l.qty}</td><td style={{ ...cell, textAlign: 'right' }}>{l.amount}</td></tr>
        ))}
        <tr><td colSpan={2} style={{ padding: '6px 8px', textAlign: 'right' }}><b>মোট</b></td><td style={{ padding: '6px 8px', textAlign: 'right' }}><b>{o.total}</b></td></tr>
      </tbody></table>
      <p><b>পেমেন্ট:</b> {o.pay}{o.note ? <><br /><b>নোট:</b> {o.note}</> : null}</p>
      <p><a href={o.link} style={{ display: 'inline-block', background: '#0a7d3b', color: '#fff', padding: '10px 18px', borderRadius: 6, textDecoration: 'none' }}>অর্ডারটি খুলুন ও প্রসেস করুন</a></p>
    </div>
  );
}

// ---------------------------------------------------------------- 🔐 the admin's delete / security code
export type CodeMail = { name: string; code: string; whatLabel: string; what: string; who: string; ip: string; device: string; when: string; minutes: string; warnDo: string };
export function DeleteCodeEmail({ m }: { m: CodeMail }) {
  return (
    <div style={{ fontFamily: 'sans-serif', fontSize: 15, lineHeight: 1.6 }}>
      <p>{m.name}:</p><p style={{ fontSize: 30, fontWeight: 700, letterSpacing: 6, margin: '6px 0 14px' }}>{m.code}</p>
      <p><b>{m.whatLabel}:</b> {m.what}<br /><b>কে চাইলো:</b> {m.who}<br />
        <b>কোথা থেকে (IP):</b> {m.ip}<br /><b>ডিভাইস:</b> {m.device}<br /><b>সময়:</b> {m.when} (ঢাকা)</p>
      <p>কোডটি {m.minutes} মিনিট চলবে, একবারই কাজ করবে।</p>
      <p style={{ color: '#b42318' }}><b>⚠️ আপনি নিজে না চেয়ে থাকলে</b> কেউ আপনার অ্যাডমিনে ঢুকে {m.warnDo} চাইছে। কোডটি কাউকে দেবেন না — এখনই অ্যাডমিনের পাসওয়ার্ড বদলান আর Admin → নিরাপত্তা থেকে অন্য সব ডিভাইস লগআউট করুন।</p>
    </div>
  );
}

// ---------------------------------------------------------------- 👤 a customer's account code
export function AccountCodeEmail({ shop, code, minutes }: { shop: string; code: string; minutes: string }) {
  return (
    <div style={{ fontFamily: 'Arial,sans-serif', maxWidth: 420, margin: 'auto', padding: 20, border: '1px solid #e5e7eb', borderRadius: 12 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>{shop}</h2>
      <p style={{ fontSize: 15, margin: '0 0 14px' }}>আপনার অ্যাকাউন্টের যাচাই কোড:</p>
      <p style={{ fontSize: 32, fontWeight: 'bold', letterSpacing: 8, margin: '0 0 14px', color: '#111' }}>{code}</p>
      <p style={{ fontSize: 14, color: '#555', margin: 0 }}>কোডটা {minutes} মিনিট কাজ করবে। কাউকে বলবেন না।<br />আপনি কোড না চেয়ে থাকলে এই ইমেইলটা উপেক্ষা করুন।</p>
    </div>
  );
}

// ---------------------------------------------------------------- 🛍️ offers and news (to customers on the list)
export type OfferCard = { name: string; price: string; oldPrice?: string; img?: string; href: string };
export type OfferMail = {
  store: string; heading: string; homeHref: string; paragraphs: string[]; cards: OfferCard[];
  button?: { text: string; href: string } | null; contact: string; unsubHref: string; pixel?: string;
};
const p15: CSSProperties = { margin: '0 0 14px', fontSize: 15, lineHeight: 1.7, color: '#24324a' };
function Card({ c }: { c: OfferCard }) {
  return (
    <td width="50%" valign="top" style={{ padding: 6 }}>
      <a href={c.href} style={{ textDecoration: 'none', color: '#14213d', display: 'block', border: '1px solid #e3e8f0', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
        {c.img ? <img src={c.img} width={260} alt={c.name} style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 200, objectFit: 'contain', background: '#f6f8fb' }} /> : null}
        <div style={{ padding: '10px 12px 12px' }}><div style={{ fontSize: 14, lineHeight: 1.4, height: 40, overflow: 'hidden' }}>{c.name}</div>
          <div style={{ marginTop: 6, fontSize: 16, fontWeight: 'bold', color: '#0866D6' }}>{c.price}{c.oldPrice ? <>{' '}<span style={{ fontSize: 12, color: '#8a94a6', textDecoration: 'line-through', fontWeight: 'normal' }}>{c.oldPrice}</span></> : null}</div></div>
      </a>
    </td>
  );
}
export function OfferEmail({ m }: { m: OfferMail }) {
  const rows: OfferCard[][] = [];
  for (let i = 0; i < m.cards.length; i += 2) rows.push(m.cards.slice(i, i + 2));
  return (
    <html lang="bn">
      <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>{m.heading}</title></head>
      <body style={{ margin: 0, padding: 0, background: '#eef2f7', fontFamily: "'Hind Siliguri','Noto Sans Bengali',Arial,sans-serif" }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ background: '#eef2f7' }}><tbody><tr><td align="center" style={{ padding: '20px 10px' }}>
          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ maxWidth: 580, background: '#ffffff', borderRadius: 16, overflow: 'hidden' }}><tbody>
            <tr><td style={{ background: '#0866D6', padding: '18px 22px' }}><a href={m.homeHref} style={{ color: '#fff', textDecoration: 'none', fontSize: 22, fontWeight: 'bold' }}>🛍️ {m.store}</a></td></tr>
            <tr><td style={{ padding: '24px 22px 8px' }}>
              <h1 style={{ margin: '0 0 14px', fontSize: 21, lineHeight: 1.4, color: '#14213d' }}>{m.heading}</h1>
              {m.paragraphs.map((p, i) => <p key={i} style={p15}><Lines text={p} /></p>)}
            </td></tr>
            {rows.length ? (
              <tr><td style={{ padding: '0 16px' }}><table role="presentation" width="100%" cellPadding={0} cellSpacing={0}><tbody>
                {rows.map((r, i) => <tr key={i}><Card c={r[0]} />{r[1] ? <Card c={r[1]} /> : <td width="50%" />}</tr>)}
              </tbody></table></td></tr>
            ) : null}
            <tr><td style={{ padding: '4px 22px 22px' }}>
              {m.button ? <p style={{ textAlign: 'center', margin: '22px 0 6px' }}><a href={m.button.href} style={{ display: 'inline-block', background: '#f59e0b', color: '#14213d', fontWeight: 'bold', textDecoration: 'none', padding: '13px 30px', borderRadius: 10, fontSize: 16 }}>{m.button.text}</a></p> : null}
              <p style={{ margin: '16px 0 0', fontSize: 13, color: '#5b6475', textAlign: 'center' }}>🚚 সারা বাংলাদেশে হোম ডেলিভারি · ✅ ক্যাশ অন ডেলিভারি</p></td></tr>
            <tr><td style={{ background: '#f6f8fb', padding: '16px 22px', fontSize: 12, lineHeight: 1.6, color: '#8a94a6', textAlign: 'center' }}>
              {m.contact ? <>{m.contact}<br /></> : null}আপনি {m.store}-এর অফার ও নতুন পণ্যের খবর পেতে চেয়েছিলেন বলে এই ইমেইল পাচ্ছেন।<br />
              <a href={m.unsubHref} style={{ color: '#5b6475' }}>আর ইমেইল চাই না (আনসাবস্ক্রাইব)</a>
            </td></tr>
          </tbody></table>
          {m.pixel ? <img src={m.pixel} width={1} height={1} alt="" style={{ display: 'block', border: 0, width: 1, height: 1 }} /> : null}
        </td></tr></tbody></table>
      </body>
    </html>
  );
}
