// 🎤 Admin → Voice & calls (lib/admin/voice.tsx): upload a call recording (read here, sent as JSON), a new voice
// message becomes "heard" the first time it is played, and a recording shared from the phone's Phone app
// (manifest share_target → client/sw/admin-sw.ts keeps it in the cache) is picked up here, ready to upload.
import { $, $all } from '../dom.js';
import { postJSON, postForm, toast } from './core.js';

const MAX = 6 * 1024 * 1024;
const SHARED = '/admin/voice/shared-file';
const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

/** a Bangladeshi mobile number written in a file name ("Call recording 01712345678_…", "+8801712…") */
function phoneIn(name: string): string {
  const m = /(?:\+?88)?(01[3-9]\d{8})/.exec(name.replace(/[\s-]/g, ''));
  return m ? m[1] : '';
}

export function startVoice(): void {
  const form = $<HTMLFormElement>('[data-call-upload]');
  // the first play of a new message marks it heard (quietly)
  for (const a of $all<HTMLAudioElement>('audio[data-voice-play]')) {
    a.addEventListener('play', () => {
      const id = a.getAttribute('data-voice-play');
      if (!id) return;
      a.removeAttribute('data-voice-play');
      a.closest('.vc-item')?.classList.remove('is-new');
      postForm('/admin/voice', new URLSearchParams({ action: 'heard', id })).catch(() => {});
    }, { once: true });
  }
  if (!form) return;
  // the admin's service worker must be there for "Share → সবমিলবে Admin" to land here (it also carries notifications)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin/' }).catch(() => {});

  const pick = $<HTMLInputElement>('[data-call-file]', form)!;
  const label = $('[data-call-file-name]', form)!;
  const msg = $('[data-call-msg]', form)!;
  const btn = $<HTMLButtonElement>('[data-call-send]', form)!;
  const phone = form.elements.namedItem('phone') as HTMLInputElement;
  let file: Blob | null = null;
  let fileName = '';
  const take = (b: Blob, name: string) => {
    file = b; fileName = name;
    label.textContent = `🎧 ${name} (${Math.max(1, Math.round(b.size / 1024))} KB)`;
    form.classList.add('has-file');
    if (!phone.value) phone.value = phoneIn(name);
  };
  pick.addEventListener('change', () => { const f = pick.files && pick.files[0]; if (f) take(f, f.name); });

  // shared from the phone: the service worker kept the file in the cache
  if (new URLSearchParams(location.search).get('shared') === '1' && 'caches' in window) {
    caches.open('sm-share').then(async (c) => {
      const r = await c.match(SHARED);
      if (!r) return;
      const name = decodeURIComponent(r.headers.get('X-File-Name') || 'recording');
      take(await r.blob(), name);
      await c.delete(SHARED);
      $('#add-call')?.scrollIntoView({ block: 'start' });
      phone.focus({ preventScroll: true });
      toast('রেকর্ডিং এসেছে — নম্বর দিয়ে Upload চাপুন');
    }).catch(() => {});
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!file) { msg.textContent = 'Pick the recording first.'; return; }
    if (file.size > MAX) { msg.textContent = 'The file is over 6 MB — too long a call.'; return; }
    btn.disabled = true;
    msg.textContent = 'Uploading…';
    try {
      const f = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | null)?.value || '';
      const j = await postJSON<{ ok: boolean; url: string }>('/admin/voice/upload', {
        audio: await toDataUrl(file), phone: f('phone'), direction: f('direction'), note: f('note') || fileName, call_at: f('call_at'),
      }, 'Could not upload.');
      location.href = j.url;
    } catch (err) { msg.textContent = (err as Error).message; btn.disabled = false; }
  });
}
