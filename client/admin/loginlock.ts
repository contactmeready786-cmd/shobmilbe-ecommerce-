/* Owner login lock: passkeys (fingerprint / Windows Hello / phone QR).
   Used on two admin pages: the second-check page after the owner's password (/admin/verify)
   and the setup page (/admin/security/login). */
import { $, whenReady } from '../dom.js';

const BASE = '/admin/security/login';
/** what the login-lock routes say (lib/admin/security…): an error, where to go next, or that the check is done */
type Said = { error?: string; to?: string; done?: boolean; next?: boolean | string };
type Answer<T = Said> = { ok: boolean; status: number; data: T };
/** WebAuthn options as the server sends them: binary fields as base64url text */
type CreateJSON = Said & Omit<PublicKeyCredentialCreationOptions, 'challenge' | 'user' | 'excludeCredentials'> & {
  challenge: string; user: { id: string; name: string; displayName: string }; excludeCredentials?: { type: PublicKeyCredentialType; id: string }[];
};
type GetJSON = Said & Omit<PublicKeyCredentialRequestOptions, 'challenge' | 'allowCredentials'> & {
  challenge: string; allowCredentials?: { type: PublicKeyCredentialType; id: string; transports?: AuthenticatorTransport[] }[];
};

// ------------------------------------------------------------ helpers
const toB64u = (buf: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (str: string): Uint8Array<ArrayBuffer> => {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s.padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
};
async function postJSON<T = Said>(url: string, body: unknown = {}): Promise<Answer<T>> {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as T;
  return { ok: r.ok, status: r.status, data: data || ({} as T) };
}
function say(el: HTMLElement | null, text: string, bad = false): void {
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
  el.classList.toggle('is-bad', bad);
}
class GoError extends Error { to?: string }

// ------------------------------------------------------------ passkeys
const NO_PK = 'এই ব্রাউজারে পাসকি চলে না। Chrome, Edge বা Safari-র নতুন সংস্করণ ব্যবহার করুন।';
const pkSupported = () => !!(window.PublicKeyCredential && navigator.credentials?.create);
function pkError(e: unknown, creating: boolean): string {
  const n = (e as DOMException)?.name;
  if (n === 'NotAllowedError' || n === 'AbortError') return 'বাতিল করা হয়েছে বা সময় শেষ হয়ে গেছে। আবার চাপুন।';
  if (n === 'InvalidStateError' && creating) return 'এই ডিভাইসে আগেই পাসকি যোগ করা আছে।';
  if (n === 'SecurityError') return 'এই ঠিকানায় পাসকি চলছে না (HTTPS দরকার)।';
  if (n === 'NotSupportedError') return 'এই ডিভাইস/ব্রাউজারে পাসকি চলে না। Chrome, Edge বা Safari-র নতুন সংস্করণ ব্যবহার করুন।';
  return (e as Error)?.message || 'কিছু একটা ভুল হয়েছে, আবার চেষ্টা করুন।';
}
async function pkCreate(name: string): Promise<unknown> {
  if (!pkSupported()) throw new Error(NO_PK);
  const r = await postJSON<CreateJSON>(`${BASE}/passkey/options`);
  if (!r.ok) throw new Error(r.data.error || 'শুরু করা যায়নি');
  // the binary fields back from text (the rest of the options go to the browser as sent)
  const j = r.data;
  const o = { ...j, challenge: fromB64u(j.challenge), user: { ...j.user, id: fromB64u(j.user.id) },
    excludeCredentials: (j.excludeCredentials || []).map((c) => ({ type: c.type, id: fromB64u(c.id) })) };
  let cred: PublicKeyCredential;
  try { cred = (await navigator.credentials.create({ publicKey: o as PublicKeyCredentialCreationOptions })) as PublicKeyCredential; } catch (e) { throw new Error(pkError(e, true)); }
  const resp = cred.response as AuthenticatorAttestationResponse;
  const added = await postJSON(`${BASE}/passkey/add`, {
    id: cred.id, type: cred.type, name,
    transports: resp.getTransports ? resp.getTransports() : [],
    response: { clientDataJSON: toB64u(resp.clientDataJSON), attestationObject: toB64u(resp.attestationObject) },
  });
  if (!added.ok) throw new Error(added.data.error || 'যোগ করা যায়নি');
  return added.data;
}
async function pkVerify(): Promise<Answer> {
  if (!pkSupported()) throw new Error(NO_PK);
  const r = await postJSON<GetJSON>('/admin/verify/passkey/options');
  if (!r.ok) { const err = new GoError(r.data.error || 'শুরু করা যায়নি'); err.to = r.data.to; throw err; }
  const j = r.data;
  const o = { ...j, challenge: fromB64u(j.challenge),
    allowCredentials: (j.allowCredentials || []).map((c) => ({ type: c.type, id: fromB64u(c.id), ...(c.transports ? { transports: c.transports } : {}) })) };
  let cred: PublicKeyCredential;
  try { cred = (await navigator.credentials.get({ publicKey: o as PublicKeyCredentialRequestOptions })) as PublicKeyCredential; } catch (e) { throw new Error(pkError(e, false)); }
  const resp = cred.response as AuthenticatorAssertionResponse;
  return postJSON('/admin/verify/passkey', {
    id: cred.id, type: cred.type,
    response: {
      clientDataJSON: toB64u(resp.clientDataJSON), authenticatorData: toB64u(resp.authenticatorData),
      signature: toB64u(resp.signature), userHandle: resp.userHandle ? toB64u(resp.userHandle) : null,
    },
  });
}

whenReady(() => {
  // ============================================================ page: second check after the password
  const verify = $('[data-ll-verify]');
  if (verify) {
    const msg = $('[data-ll-msg]', verify);
    const pk = $('[data-ll-pk]', verify);
    if (pk) pk.hidden = false;
    const pkBtn = $<HTMLButtonElement>('[data-ll-pk-go]', verify);
    pkBtn?.addEventListener('click', async () => {
      pkBtn.disabled = true;
      say(msg, '');
      try {
        const r = await pkVerify();
        if (r.ok && r.data.done) { say(msg, ''); location.href = r.data.to || '/admin'; return; }
        if (r.ok && r.data.next) { location.reload(); return; }
        say(msg, r.data.error || 'যাচাই হয়নি, আবার চেষ্টা করুন।', true);
        const to = r.data.to;
        if (to) setTimeout(() => { location.href = to; }, 2500);
      } catch (e) {
        say(msg, (e as Error).message || 'কিছু একটা ভুল হয়েছে।', true);
        const to = (e as GoError).to;
        if (to) setTimeout(() => { location.href = to; }, 2500);
      } finally {
        pkBtn.disabled = false;
      }
    });
  }

  // ============================================================ page: setup (Admin → লগইন তালা)
  const pkReg = $<HTMLButtonElement>('[data-ll-pk-register]');
  if (pkReg) {
    const note = $('[data-ll-pk-note]');
    pkReg.addEventListener('click', async () => {
      const nameEl = $<HTMLInputElement>('input[name="pk_name"]');
      pkReg.disabled = true;
      say(note, '👆 ডিভাইসের আঙুলের ছাপ / স্ক্রিন লক দিন…');
      try {
        await pkCreate(nameEl ? nameEl.value : '');
        say(note, '✅ পাসকি যোগ হয়েছে।');
        location.href = `${BASE}?msg=added&t=${Date.now()}#passkeys`;
      } catch (e) {
        say(note, `❌ ${(e as Error).message}`, true);
        pkReg.disabled = false;
      }
    });
  }
});
