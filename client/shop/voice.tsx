// 🎤 Voice message (owner, 2026-11-23): in the help box a customer records up to 2 minutes, listens back, leaves a
// mobile number and sends it — no typing needed. POST /api/voice (lib/api/shop-actions.ts voice); the shop hears it
// in Admin → Voice & calls. The browser asks for the microphone only when the customer taps record.
import { h, Fragment, paint } from '../jsx.js';
import { postJson, store } from '../dom.js';

void Fragment;
const MAX_SEC = 120;
const BN = '০১২৩৪৫৬৭৮৯';
const bn = (n: number | string) => String(n).replace(/\d/g, (d) => BN[Number(d)]);
const clock = (s: number) => `${bn(Math.floor(s / 60))}:${bn(String(s % 60).padStart(2, '0'))}`;

function pickType(): string {
  const R = window.MediaRecorder;
  for (const t of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) {
    try { if (R && R.isTypeSupported(t)) return t; } catch { /* next */ }
  }
  return '';
}

const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

/** the voice-message panel; `back` returns to the help answers */
export function VoicePanel({ back, phone }: { back: () => void; phone: string }): HTMLElement {
  const can = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof window.MediaRecorder === 'function';
  const status = <p className="vm-status" aria-live="polite"></p> as HTMLElement;
  const time = <span className="vm-time">{clock(0)}</span> as HTMLElement;
  const recBtn = <button type="button" className="vm-mic" aria-label="রেকর্ড শুরু করুন"><span className="vm-dot" aria-hidden="true"></span></button> as HTMLButtonElement;
  const hint = <p className="vm-hint">বোতাম চেপে কথা বলুন, শেষ হলে আবার চাপুন (সর্বোচ্চ ২ মিনিট)</p> as HTMLElement;
  const player = <audio className="vm-audio" controls preload="metadata"></audio> as HTMLAudioElement;
  const phoneIn = <input name="phone" type="tel" inputmode="tel" required maxlength="15" placeholder="আপনার মোবাইল নম্বর" aria-label="আপনার মোবাইল নম্বর" autocomplete="tel" /> as HTMLInputElement;
  phoneIn.value = store('sm_voice_phone') || phone || '';
  const nameIn = <input name="name" maxlength="60" placeholder="নাম (ইচ্ছা হলে)" aria-label="নাম" autocomplete="name" /> as HTMLInputElement;
  const trap = <input name="website" tabindex="-1" autocomplete="off" className="hp" aria-hidden="true" /> as HTMLInputElement;
  const sendBtn = <button type="submit" className="btn btn-sm vm-send">📤 পাঠান</button> as HTMLButtonElement;
  const again = <button type="button" className="btn btn-sm btn-ghost">🔁 আবার রেকর্ড</button> as HTMLButtonElement;
  const review = <form className="vm-review" hidden>{player}<div className="vm-fields">{phoneIn}{nameIn}{trap}</div><div className="vm-actions">{again}{sendBtn}</div></form> as HTMLFormElement;
  const recorder = <div className="vm-rec">{recBtn}{time}</div> as HTMLElement;

  let rec: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let blob: Blob | null = null;
  let secs = 0;
  let timer = 0;
  let started = 0;

  const say = (t: string, cls = '') => { status.textContent = t; status.className = `vm-status ${cls}`; };
  const stopTracks = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const stop = () => { if (rec && rec.state !== 'inactive') rec.stop(); clearInterval(timer); };
  const reset = () => {
    blob = null; chunks = []; secs = 0;
    if (player.src) URL.revokeObjectURL(player.src);
    player.removeAttribute('src');
    review.hidden = true; recorder.hidden = false; hint.hidden = false;
    time.textContent = clock(0); recBtn.classList.remove('on'); recBtn.setAttribute('aria-label', 'রেকর্ড শুরু করুন');
    say('');
  };

  const start = async () => {
    if (!can) { say('এই ব্রাউজারে রেকর্ড করা যায় না। Chrome-এ খুলুন, অথবা সরাসরি ফোন করুন।', 'warn'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      say('মাইক্রোফোনের অনুমতি দেওয়া হয়নি। ব্রাউজারের ঠিকানার পাশের 🔒 থেকে মাইক্রোফোন চালু করুন।', 'warn');
      return;
    }
    const type = pickType();
    rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stopTracks();
      secs = Math.max(1, Math.round((Date.now() - started) / 1000));
      blob = new Blob(chunks, { type: rec?.mimeType || type || 'audio/webm' });
      if (blob.size < 800) { reset(); say('কিছু রেকর্ড হয়নি — আবার চেষ্টা করুন।', 'warn'); return; }
      player.src = URL.createObjectURL(blob);
      recorder.hidden = true; hint.hidden = true; review.hidden = false;
      say(`রেকর্ড হয়েছে (${clock(secs)})। শুনে দেখুন, তারপর নম্বর দিয়ে পাঠান।`);
      if (!phoneIn.value) phoneIn.focus({ preventScroll: true });
    };
    started = Date.now();
    rec.start(1000);
    recBtn.classList.add('on'); recBtn.setAttribute('aria-label', 'রেকর্ড থামান');
    say('রেকর্ড হচ্ছে… কথা শেষ হলে আবার চাপুন', 'live');
    timer = window.setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      time.textContent = clock(s);
      if (s >= MAX_SEC) stop();
    }, 250);
  };

  recBtn.addEventListener('click', () => (rec && rec.state === 'recording' ? stop() : void start()));
  again.addEventListener('click', () => { reset(); void start(); });
  review.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!blob) return;
    const phone = phoneIn.value.trim();
    if (!/^(?:\+?88)?0?1[3-9][0-9]{8}$/.test(phone.replace(/[০-৯]/g, (d) => String(BN.indexOf(d))).replace(/[\s-]/g, ''))) {
      say('সঠিক মোবাইল নম্বর দিন, যেমন ০১৭১২৩৪৫৬৭৮।', 'warn'); phoneIn.focus(); return;
    }
    sendBtn.disabled = true; again.disabled = true;
    say('পাঠানো হচ্ছে…');
    try {
      const code = new URLSearchParams(location.search).get('code') || '';
      const x = await postJson<{ ok?: boolean; message?: string; error?: string }>('/api/voice', {
        audio: await toDataUrl(blob), phone, name: nameIn.value.trim(), seconds: secs, order: code, page: location.pathname, website: trap.value,
      });
      if (x.ok) {
        store('sm_voice_phone', phone);
        paint(review, <p className="vm-done">✅ {x.j.message || 'ধন্যবাদ! আপনার মেসেজ পৌঁছেছে।'}</p>);
        review.hidden = false;
        say('');
      } else { say(x.j.error || 'পাঠানো যায়নি, আবার চেষ্টা করুন।', 'warn'); sendBtn.disabled = false; again.disabled = false; }
    } catch { say('পাঠানো যায়নি — ইন্টারনেট দেখে আবার চেষ্টা করুন।', 'warn'); sendBtn.disabled = false; again.disabled = false; }
  });

  const panel = (
    <div className="vm" role="group" aria-label="ভয়েস মেসেজ">
      <button type="button" className="vm-back" onClick={() => { stop(); stopTracks(); back(); }}>← ফিরে যান</button>
      <p className="vm-title">🎤 ভয়েস মেসেজ পাঠান</p>
      <p className="vm-sub">লিখতে হবে না — আপনার প্রশ্ন, সমস্যা বা অর্ডারের কথা বলে পাঠান। আমরা শুনে ফোন করব।</p>
      {recorder}{hint}{review}{status}
    </div>
  );
  // clicks inside the panel stay here: the help box closes on outside clicks, and parts of this panel come and go
  panel.addEventListener('click', (e) => e.stopPropagation());
  return panel;
}
