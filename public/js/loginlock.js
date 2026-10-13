/* Owner login lock: passkeys (fingerprint / Windows Hello / phone QR).
   Used on two admin pages: the second-check page after the owner's password (/admin/verify)
   and the setup page (/admin/security/login). */
(function () {
  'use strict';
  var BASE = '/admin/security/login';
  function $(s, r) { return (r || document).querySelector(s); }

  // ------------------------------------------------------------ helpers
  function toB64u(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64u(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data || {} }; });
    });
  }
  function show(el, on) { if (el) el.hidden = !on; }
  function say(el, text, bad) { if (!el) return; el.textContent = text || ''; el.hidden = !text; el.classList.toggle('is-bad', !!bad); }

  // ------------------------------------------------------------ passkeys
  function pkSupported() { return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create); }
  function pkError(e, creating) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'AbortError') return 'বাতিল করা হয়েছে বা সময় শেষ হয়ে গেছে। আবার চাপুন।';
    if (n === 'InvalidStateError' && creating) return 'এই ডিভাইসে আগেই পাসকি যোগ করা আছে।';
    if (n === 'SecurityError') return 'এই ঠিকানায় পাসকি চলছে না (HTTPS দরকার)।';
    if (n === 'NotSupportedError') return 'এই ডিভাইস/ব্রাউজারে পাসকি চলে না। Chrome, Edge বা Safari-র নতুন সংস্করণ ব্যবহার করুন।';
    return (e && e.message) || 'কিছু একটা ভুল হয়েছে, আবার চেষ্টা করুন।';
  }
  function pkCreate(name) {
    if (!pkSupported()) return Promise.reject(new Error('এই ব্রাউজারে পাসকি চলে না। Chrome, Edge বা Safari-র নতুন সংস্করণ ব্যবহার করুন।'));
    return postJSON(BASE + '/passkey/options').then(function (r) {
      if (!r.ok) throw new Error(r.data.error || 'শুরু করা যায়নি');
      var o = r.data;
      o.challenge = fromB64u(o.challenge);
      o.user.id = fromB64u(o.user.id);
      o.excludeCredentials = (o.excludeCredentials || []).map(function (c) { return { type: c.type, id: fromB64u(c.id) }; });
      return navigator.credentials.create({ publicKey: o }).catch(function (e) { throw new Error(pkError(e, true)); });
    }).then(function (cred) {
      var resp = cred.response;
      return postJSON(BASE + '/passkey/add', {
        id: cred.id, type: cred.type, name: name,
        transports: resp.getTransports ? resp.getTransports() : [],
        response: { clientDataJSON: toB64u(resp.clientDataJSON), attestationObject: toB64u(resp.attestationObject) },
      });
    }).then(function (r) {
      if (!r.ok) throw new Error(r.data.error || 'যোগ করা যায়নি');
      return r.data;
    });
  }
  function pkVerify() {
    if (!pkSupported()) return Promise.reject(new Error('এই ব্রাউজারে পাসকি চলে না। Chrome, Edge বা Safari-র নতুন সংস্করণ ব্যবহার করুন।'));
    return postJSON('/admin/verify/passkey/options').then(function (r) {
      if (!r.ok) { var err = new Error(r.data.error || 'শুরু করা যায়নি'); err.to = r.data.to; throw err; }
      var o = r.data;
      o.challenge = fromB64u(o.challenge);
      o.allowCredentials = (o.allowCredentials || []).map(function (c) { var x = { type: c.type, id: fromB64u(c.id) }; if (c.transports) x.transports = c.transports; return x; });
      return navigator.credentials.get({ publicKey: o }).catch(function (e) { throw new Error(pkError(e, false)); });
    }).then(function (cred) {
      var resp = cred.response;
      return postJSON('/admin/verify/passkey', {
        id: cred.id, type: cred.type,
        response: {
          clientDataJSON: toB64u(resp.clientDataJSON), authenticatorData: toB64u(resp.authenticatorData),
          signature: toB64u(resp.signature), userHandle: resp.userHandle ? toB64u(resp.userHandle) : null,
        },
      });
    });
  }

  // ============================================================ page: second check after the password
  var verify = $('[data-ll-verify]');
  if (verify) {
    var msg = $('[data-ll-msg]', verify);
    show($('[data-ll-pk]', verify), true);
    var finish = function (r) {
      if (r.ok && r.data.done) { say(msg, ''); location.href = r.data.to || '/admin'; return; }
      if (r.ok && r.data.next) { location.reload(); return; }
      say(msg, r.data.error || 'যাচাই হয়নি, আবার চেষ্টা করুন।', true);
      if (r.data.to) setTimeout(function () { location.href = r.data.to; }, 2500);
    };
    var failMsg = function (e) {
      say(msg, e.message || 'কিছু একটা ভুল হয়েছে।', true);
      if (e.to) setTimeout(function () { location.href = e.to; }, 2500);
    };
    var pkBtn = $('[data-ll-pk-go]', verify);
    if (pkBtn) pkBtn.addEventListener('click', function () {
      pkBtn.disabled = true; say(msg, '');
      pkVerify().then(finish, failMsg).then(function () { pkBtn.disabled = false; });
    });
  }

  // ============================================================ page: setup (Admin → লগইন তালা)
  var pkReg = $('[data-ll-pk-register]');
  if (pkReg) {
    var note = $('[data-ll-pk-note]');
    pkReg.addEventListener('click', function () {
      var nameEl = document.querySelector('input[name="pk_name"]');
      pkReg.disabled = true;
      say(note, '👆 ডিভাইসের আঙুলের ছাপ / স্ক্রিন লক দিন…');
      pkCreate(nameEl ? nameEl.value : '').then(function () {
        say(note, '✅ পাসকি যোগ হয়েছে।');
        location.href = BASE + '?msg=added&t=' + Date.now() + '#passkeys';
      }, function (e) { say(note, '❌ ' + e.message, true); pkReg.disabled = false; });
    });
  }
})();
