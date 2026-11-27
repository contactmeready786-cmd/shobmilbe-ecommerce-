// 🎓 ফ্রি ইলেকট্রনিক্স ক্লাস in the browser (lib/views/learn.tsx draws the pages):
// the lesson quiz (checked here, no server), "✅ শেষ করেছেন" marks kept in this browser, and the AI teacher box
// (POST /api/learn → lib/api/learn.ts) with the parts it names from the shop.
import { h, paint } from '../jsx.js';
import { $, $all, bn, money, postJson, readJson, store } from '../dom.js';
import { track } from './track.js';

type TutorAnswer = { answer?: string; error?: string; products?: { name: string; slug: string; price: number; image: string | null; emoji: string }[] };
const DONE_KEY = 'sm_learn_done';

export function startLearn(): void {
  marks();
  quiz();
  tutor();
  certificate();
}

const doneList = (): string[] => readJson<string[]>(DONE_KEY, []);

// the lesson list: lessons this browser finished get "✅ শেষ করেছেন", a progress line, and — all done — the certificate
function marks(): void {
  if (!$('[data-learn-list]')) return;
  const done = doneList();
  const cards = $all('[data-lesson-card]');
  let n = 0;
  for (const card of cards) {
    if (!done.includes(card.getAttribute('data-lesson-card') || '')) continue;
    n++;
    const m = $<HTMLElement>('[data-done-mark]', card);
    if (m) m.hidden = false;
  }
  const prog = $<HTMLElement>('[data-learn-progress]');
  if (prog && n) { prog.hidden = false; prog.textContent = `আপনার অগ্রগতি: ${bn(n)}/${bn(cards.length)} লেসন শেষ${n < cards.length ? ' — সব শেষ করলে সার্টিফিকেট পাবেন 🎓' : ''}`; }
  const cert = $<HTMLElement>('[data-cert]');
  if (cert && cards.length && n === cards.length) cert.hidden = false;
}

function quiz(): void {
  const box = $('[data-quiz]');
  const page = $('[data-lesson-page]');
  if (!box || !page) return;
  const slug = page.getAttribute('data-lesson-page') || '';
  $('[data-quiz-check]', box)?.addEventListener('click', () => {
    const qs = $all('[data-quiz-q]', box);
    let right = 0;
    let answered = 0;
    for (const q of qs) {
      const want = q.getAttribute('data-answer');
      const picked = $<HTMLInputElement>('input:checked', q);
      q.classList.remove('is-right', 'is-wrong');
      if (!picked) continue;
      answered++;
      const ok = picked.value === want;
      if (ok) right++;
      q.classList.add(ok ? 'is-right' : 'is-wrong');
      const why = $<HTMLElement>('[data-quiz-why]', q);
      if (why) why.hidden = false;
    }
    const score = $('[data-quiz-score]', box);
    if (!score) return;
    if (answered < qs.length) { score.textContent = `সবগুলো প্রশ্নের উত্তর বাছুন (${bn(qs.length - answered)}টা বাকি)।`; return; }
    if (right === qs.length) {
      score.textContent = `🎉 দারুণ! ${bn(right)}/${bn(qs.length)} — এই লেসন শেষ।`;
      const done = doneList();
      if (!done.includes(slug)) { done.push(slug); store(DONE_KEY, JSON.stringify(done.slice(-50))); }
      const link = $<HTMLElement>('[data-cert-link]', box);
      if (link && done.length >= (Number(link.getAttribute('data-total')) || 99)) link.hidden = false;
      track('learn_quiz_pass', { label: slug });
    } else {
      score.textContent = `${bn(right)}/${bn(qs.length)} ঠিক হয়েছে। লাল চিহ্নের ব্যাখ্যা পড়ে আবার চেষ্টা করুন।`;
    }
  });
}

function tutor(): void {
  for (const box of $all('[data-tutor]')) {
    const form = $<HTMLFormElement>('[data-tutor-form]', box);
    const out = $<HTMLElement>('[data-tutor-answer]', box);
    const btn = $<HTMLButtonElement>('[data-tutor-send]', box);
    if (!form || !out || !btn) continue;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const q = String(fd.get('q') || '').trim();
      if (q.length < 4) return;
      btn.disabled = true;
      out.hidden = false;
      paint(out, <p className="muted">🧑‍🏫 শিক্ষক ভাবছেন…</p>);
      try {
        const { j } = await postJson<TutorAnswer>('/api/learn', { q, lesson: box.getAttribute('data-lesson') || '', website: fd.get('website') || '' });
        if (!j.answer) { paint(out, <p className="warn">{j.error || 'উত্তর পাওয়া যায়নি। আবার চেষ্টা করুন।'}</p>); return; }
        const items = j.products || [];
        paint(out,
          <div className="learn-answer-text">{j.answer}</div>,
          items.length ? <div className="learn-answer-parts"><p className="small"><b>🧰 দরকারি পার্টস সবমিলবে-তে:</b></p><ul>{items.map((p) => (
            <li><a href={`/p/${encodeURIComponent(p.slug)}`}>{p.image ? <img src={p.image} alt="" loading="lazy" /> : <span>{p.emoji || '📦'}</span>}<span>{p.name}</span><b>{money(p.price)}</b></a></li>
          ))}</ul></div> : null);
        track('learn_ask', { label: box.getAttribute('data-lesson') || 'list' });
      } catch {
        paint(out, <p className="warn">ইন্টারনেট সংযোগে সমস্যা। আবার চেষ্টা করুন।</p>);
      } finally {
        btn.disabled = false;
      }
    });
  }
}


// ---------- 🎓 the certificate: drawn in the browser (no server, nothing saved), downloaded as a picture ----------
const BN_FONT = '"Noto Sans Bengali", system-ui, sans-serif';
function certificate(): void {
  const box = $('[data-cert]');
  const form = $<HTMLFormElement>('[data-cert-form]', box);
  if (!box || !form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = String(new FormData(form).get('name') || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (name.length < 2) return;
    try { await Promise.all([document.fonts.load(`700 60px ${BN_FONT}`), document.fonts.load(`400 30px ${BN_FONT}`)]); } catch { /* draws with what is there */ }
    const url = drawCertificate(name, box.getAttribute('data-topics') || '');
    const out = $<HTMLElement>('[data-cert-out]', box);
    const img = $<HTMLImageElement>('[data-cert-img]', box);
    const dl = $<HTMLAnchorElement>('[data-cert-download]', box);
    if (!out || !img || !dl) return;
    img.src = url;
    dl.href = url;
    out.hidden = false;
    track('learn_certificate', { label: 'all' });
  });
}

function drawCertificate(name: string, topics: string): string {
  const W = 1600, H = 1131;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  if (!x) return '';
  const center = (t: string, y: number, font: string, color: string) => { x.font = font; x.fillStyle = color; x.textAlign = 'center'; x.fillText(t, W / 2, y); };
  // paper and two borders
  const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#fffdf6'); g.addColorStop(1, '#f3f7ff');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#0866D6'; x.lineWidth = 14; x.strokeRect(36, 36, W - 72, H - 72);
  x.strokeStyle = '#F5A524'; x.lineWidth = 4; x.strokeRect(66, 66, W - 132, H - 132);
  // corner circuit dots
  x.fillStyle = 'rgba(8,102,214,.18)';
  for (const [a, b] of [[110, 110], [W - 110, 110], [110, H - 110], [W - 110, H - 110]]) { x.beginPath(); x.arc(a, b, 16, 0, 7); x.fill(); }
  // the shop's name as its logo: সব blue + মিলবে amber
  x.font = `800 64px ${BN_FONT}`; x.textAlign = 'left';
  const w1 = x.measureText('সব').width, w2 = x.measureText('মিলবে').width;
  x.fillStyle = '#0866D6'; x.fillText('সব', W / 2 - (w1 + w2) / 2, 190);
  x.fillStyle = '#F5A524'; x.fillText('মিলবে', W / 2 - (w1 + w2) / 2 + w1, 190);
  center('ফ্রি ইলেকট্রনিক্স ক্লাস', 245, `600 32px ${BN_FONT}`, '#33415C');
  center('সার্টিফিকেট', 370, `800 92px ${BN_FONT}`, '#14213D');
  center('সফলভাবে কোর্স শেষ করার স্বীকৃতি হিসেবে এই সনদ দেওয়া হলো', 440, `400 30px ${BN_FONT}`, '#5B6B85');
  center(name, 560, `700 76px ${BN_FONT}`, '#0866D6');
  x.strokeStyle = '#D5DEEA'; x.lineWidth = 3; x.beginPath(); x.moveTo(420, 595); x.lineTo(W - 420, 595); x.stroke();
  center('অনলাইনে সবগুলো লেসন পড়ে প্রতিটার কুইজ পাশ করেছেন:', 665, `400 30px ${BN_FONT}`, '#33415C');
  // the lessons, wrapped to fit
  x.font = `600 28px ${BN_FONT}`;
  const lines: string[] = [];
  let line = '';
  for (const part of topics.split(' • ').filter(Boolean)) {
    const next = line ? `${line}  •  ${part}` : part;
    if (x.measureText(next).width > W - 360 && line) { lines.push(line); line = part; } else line = next;
  }
  if (line) lines.push(line);
  lines.slice(0, 4).forEach((t, i) => center(t, 715 + i * 44, `600 27px ${BN_FONT}`, '#14213D'));
  const d = new Date();
  const date = `${bn(d.getDate())}/${bn(d.getMonth() + 1)}/${bn(d.getFullYear())}`;
  const id = 'SM-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  x.font = `400 26px ${BN_FONT}`; x.fillStyle = '#5B6B85';
  x.textAlign = 'left'; x.fillText(`তারিখ: ${date}`, 150, H - 150);
  x.textAlign = 'right'; x.fillText(`সনদ নং: ${id}`, W - 150, H - 150);
  center('shobmilbe.com/learn', H - 150, `700 28px ${BN_FONT}`, '#0866D6');
  return c.toDataURL('image/png');
}
