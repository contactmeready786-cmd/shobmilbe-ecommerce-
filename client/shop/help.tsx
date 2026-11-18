// 🙋 The help button (owner, 2026-11-18): one round "সাহায্য" button in the corner instead of separate WhatsApp /
// Messenger / live-chat bubbles. Tapping it opens a small box: the owner's ready answers (tap a question, or type
// one — lib/models/helpbot.ts, matched by client/shop/helpmatch.ts), an order-track box, and "উত্তর পাননি?" with
// WhatsApp (the typed question already written), Messenger, live chat (Tawk) and a call button.
import { h, Fragment, paint } from '../jsx.js';
import { $ } from '../dom.js';
import type { ShopConfig } from '../shop-config.js';
import { bestMatches, type HelpConfig, type HelpItem } from './helpmatch.js';
import { track } from './track.js';

export function startHelp(): void {
  const SM: Partial<ShopConfig> = window.SM || {};
  const cfg = SM.help;
  const btn = $<HTMLButtonElement>('[data-help-open]');
  if (!cfg || !btn) return;
  let box: HTMLElement | null = null;
  const close = () => {
    if (!box) return;
    box.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('open');
  };
  const open = () => {
    box = box || build(cfg, close);
    box.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('open');
    $<HTMLInputElement>('[data-help-q]', box)?.focus({ preventScroll: true });
  };
  btn.addEventListener('click', () => (box && !box.hidden ? close() : open()));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.addEventListener('click', (e) => {
    const t = e.target as Node | null;
    if (box && !box.hidden && t && !box.contains(t) && !btn.contains(t)) close();
  });
}

function build(cfg: HelpConfig, close: () => void): HTMLElement {
  const answers = h('div', { className: 'help-found', 'aria-live': 'polite' });
  const input = h('input', { type: 'search', name: 'q', maxlength: '120', placeholder: 'আপনার প্রশ্ন লিখুন…', 'aria-label': 'আপনার প্রশ্ন', 'data-help-q': '', autocomplete: 'off' }) as HTMLInputElement;
  let asked = '';

  const ask = (e: Event) => {
    e.preventDefault();
    asked = input.value.trim();
    if (!asked) { paint(answers); return; }
    const found = bestMatches(cfg.items, asked);
    paint(answers, found.length
      ? found.map((it) => <Answer item={it} open />)
      : <p className="help-none">এই প্রশ্নের তৈরি উত্তর আমাদের কাছে নেই। নিচের যেকোনো উপায়ে সরাসরি জিজ্ঞেস করুন — আমরা দ্রুত উত্তর দেব।</p>);
    paint(contactRow, ...contacts(cfg, asked, close));
  };

  const contactRow = h('div', { className: 'help-contact' }, ...contacts(cfg, '', close));
  const box = (
    <div className="help-box" role="dialog" aria-label="সাহায্য" hidden>
      <div className="help-head">
        <b>🙋 কিভাবে সাহায্য করতে পারি?</b>
        <button type="button" className="help-x" aria-label="বন্ধ করুন" onClick={close}>✕</button>
      </div>
      <div className="help-body">
        <form className="help-ask" onSubmit={ask}>{input}<button type="submit" className="btn btn-sm">খুঁজুন</button></form>
        {answers}
        {cfg.items.length ? <><p className="help-label">সাধারণ প্রশ্ন</p><div className="help-list">{cfg.items.map((it) => <Answer item={it} />)}</div></> : null}
        {cfg.track ? (
          <form className="help-track" method="get" action="/track">
            <p className="help-label">📦 অর্ডার ট্র্যাক করুন</p>
            <div className="help-track-row">
              <input name="code" required placeholder="অর্ডার নম্বর" aria-label="অর্ডার নম্বর" autocapitalize="characters" />
              <input name="phone" required inputmode="tel" placeholder="মোবাইল নম্বর" aria-label="মোবাইল নম্বর" />
              <button type="submit" className="btn btn-sm">দেখুন</button>
            </div>
          </form>
        ) : null}
      </div>
      <div className="help-foot">
        <p className="help-label">উত্তর পাননি? সরাসরি কথা বলুন</p>
        {contactRow}
      </div>
    </div>
  );
  document.body.appendChild(box);
  return box;
}

/** one ready answer: the question as a button that folds the answer open */
function Answer({ item, open = false }: { item: HelpItem; open?: boolean }): HTMLElement {
  return (
    <details className="help-item" open={open}>
      <summary>{item.q}</summary>
      <p>{item.a}</p>
    </details>
  );
}

/** the ways to reach the shop; WhatsApp gets the typed question written in already */
function contacts(cfg: HelpConfig, asked: string, close: () => void): HTMLElement[] {
  const out: HTMLElement[] = [];
  const text = asked ? `?text=${encodeURIComponent(asked)}` : '';
  const said = () => track('contact', { label: 'help' });
  if (cfg.wa) out.push(<a className="help-c wa" href={`https://wa.me/${cfg.wa}${text}`} target="_blank" rel="noopener" onClick={said}>WhatsApp</a>);
  if (cfg.ms) out.push(<a className="help-c ms" href={`https://m.me/${cfg.ms}`} target="_blank" rel="noopener" onClick={said}>Messenger</a>);
  if (cfg.tawk) {
    out.push(<button type="button" className="help-c live" onClick={() => {
      const T = window.Tawk_API;
      said();
      if (T && T.maximize) { T.showWidget?.(); T.maximize(); close(); }
    }}>লাইভ চ্যাট</button>);
  }
  if (cfg.phone) out.push(<a className="help-c call" href={`tel:${cfg.phone}`} onClick={said}>📞 কল করুন</a>);
  if (!out.length) out.push(<a className="help-c" href="/complaint">📮 সমস্যা জানান</a>);
  return out;
}
