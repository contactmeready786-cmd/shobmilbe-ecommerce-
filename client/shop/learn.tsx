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
}

const doneList = (): string[] => readJson<string[]>(DONE_KEY, []);

// the lesson list: lessons this browser finished get "✅ শেষ করেছেন"
function marks(): void {
  if (!$('[data-learn-list]')) return;
  const done = doneList();
  for (const card of $all('[data-lesson-card]')) {
    if (!done.includes(card.getAttribute('data-lesson-card') || '')) continue;
    const m = $<HTMLElement>('[data-done-mark]', card);
    if (m) m.hidden = false;
  }
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
          items.length ? <div className="learn-answer-parts"><p className="small"><b>🧰 দরকারি পার্টস সবমিলবে-তে:</b></p><ul className="suggest-list">{items.map((p) => (
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

