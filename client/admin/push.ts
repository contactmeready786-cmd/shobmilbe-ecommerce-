/* Admin → নোটিফিকেশন: turn on phone notifications for this device (one tap). */
import { $, whenReady } from '../dom.js';

whenReady(() => {
  const box = $('[data-push]');
  const btn = $<HTMLButtonElement>('[data-push-on]', box);
  const note = $('[data-push-note]', box);
  if (box && btn && note) start(box, btn, note);
});

function start(box: HTMLElement, btn: HTMLButtonElement, note: HTMLElement): void {
  const key = box.getAttribute('data-key') || '';
  const say = (t: string, bad = false) => { note.textContent = t; note.hidden = !t; note.style.color = bad ? '#C42E2E' : ''; };
  const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
  const ua = navigator.userAgent;
  const device = () => /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android ফোন'
    : /Windows/.test(ua) ? 'Windows কম্পিউটার' : /Mac/.test(ua) ? 'Mac' : 'ডিভাইস';
  const ios = /iPhone|iPad/.test(ua);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) {
    btn.disabled = true;
    if (ios && !standalone) say('iPhone-এ: নিচের Share (⬆️) বোতাম → "Add to Home Screen" চাপুন। তারপর হোম স্ক্রিনের নতুন "সবমিলবে Admin" আইকন থেকে এই পেজ খুলে আবার চাপুন।');
    else say('এই ব্রাউজারে নোটিফিকেশন চলে না। ফোনে Chrome দিয়ে খুলুন।', true);
    return;
  }
  if (Notification.permission === 'denied') say('এই ব্রাউজারে নোটিফিকেশন বন্ধ করা আছে। ঠিকানার পাশের 🔒 চিহ্ন → Notifications → Allow করুন, তারপর আবার চাপুন।', true);
  navigator.serviceWorker.getRegistration('/admin/')
    .then((reg) => reg?.pushManager.getSubscription())
    .then((sub) => { if (sub && Notification.permission === 'granted') btn.textContent = '✅ এই ডিভাইসে চালু আছে (আবার চাপলে নতুন করে চালু হবে)'; })
    .catch(() => {});

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    say('⏳ চালু হচ্ছে… "Allow" / "অনুমতি দিন" চাইলে চাপুন।');
    try {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('অনুমতি দেওয়া হয়নি। আবার চাপুন আর "Allow" বেছে নিন।');
      await navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin/' });
      const reg = await navigator.serviceWorker.ready;
      await (await reg.pushManager.getSubscription())?.unsubscribe();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) });
      const r = await fetch('/admin/notify/push/subscribe', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ sub: sub.toJSON(), device: device() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'সেভ হয়নি');
      say('✅ চালু হয়েছে! একটা টেস্ট নোটিফিকেশন পাঠানো হয়েছে, ফোনে দেখুন।');
      setTimeout(() => { location.href = `/admin/notify?msg=saved&t=${Date.now()}#push`; }, 2500);
    } catch (e) {
      say(`❌ ${(e as Error).message || 'চালু করা যায়নি'}`, true);
      btn.disabled = false;
    }
  });
}
