/* Admin → নোটিফিকেশন: turn on phone notifications for this device (one tap). */
(function () {
  'use strict';
  var box = document.querySelector('[data-push]');
  if (!box) return;
  var btn = box.querySelector('[data-push-on]');
  var note = box.querySelector('[data-push-note]');
  var key = box.getAttribute('data-key');
  function say(t, bad) { note.textContent = t; note.hidden = !t; note.style.color = bad ? '#C42E2E' : ''; }
  function fromB64u(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a;
  }
  function device() {
    var u = navigator.userAgent;
    if (/iPhone/.test(u)) return 'iPhone'; if (/iPad/.test(u)) return 'iPad';
    if (/Android/.test(u)) return 'Android ফোন'; if (/Windows/.test(u)) return 'Windows কম্পিউটার';
    if (/Mac/.test(u)) return 'Mac'; return 'ডিভাইস';
  }
  var ios = /iPhone|iPad/.test(navigator.userAgent);
  var standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) {
    btn.disabled = true;
    if (ios && !standalone) say('iPhone-এ: নিচের Share (⬆️) বোতাম → "Add to Home Screen" চাপুন। তারপর হোম স্ক্রিনের নতুন "সবমিলবে Admin" আইকন থেকে এই পেজ খুলে আবার চাপুন।');
    else say('এই ব্রাউজারে নোটিফিকেশন চলে না। ফোনে Chrome দিয়ে খুলুন।', true);
    return;
  }
  if (Notification.permission === 'denied') say('এই ব্রাউজারে নোটিফিকেশন বন্ধ করা আছে। ঠিকানার পাশের 🔒 চিহ্ন → Notifications → Allow করুন, তারপর আবার চাপুন।', true);
  navigator.serviceWorker.getRegistration('/admin/').then(function (reg) {
    return reg && reg.pushManager.getSubscription();
  }).then(function (sub) {
    if (sub && Notification.permission === 'granted') { btn.textContent = '✅ এই ডিভাইসে চালু আছে (আবার চাপলে নতুন করে চালু হবে)'; }
  }).catch(function () {});

  btn.addEventListener('click', function () {
    btn.disabled = true; say('⏳ চালু হচ্ছে… "Allow" / "অনুমতি দিন" চাইলে চাপুন।');
    Notification.requestPermission().then(function (p) {
      if (p !== 'granted') throw new Error('অনুমতি দেওয়া হয়নি। আবার চাপুন আর "Allow" বেছে নিন।');
      return navigator.serviceWorker.register('/admin-sw.js', { scope: '/admin/' });
    }).then(function () { return navigator.serviceWorker.ready; })
      .then(function (reg) {
        return reg.pushManager.getSubscription().then(function (old) {
          return old ? old.unsubscribe() : null;
        }).then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) }); });
      }).then(function (sub) {
        return fetch('/admin/notify/push/subscribe', {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ sub: sub.toJSON(), device: device() }),
        }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'সেভ হয়নি'); return d; }); });
      }).then(function () {
        say('✅ চালু হয়েছে! একটা টেস্ট নোটিফিকেশন পাঠানো হয়েছে, ফোনে দেখুন।');
        setTimeout(function () { location.href = '/admin/notify?msg=saved&t=' + Date.now() + '#push'; }, 2500);
      }).catch(function (e) { say('❌ ' + (e.message || 'চালু করা যায়নি'), true); btn.disabled = false; });
  });
})();
